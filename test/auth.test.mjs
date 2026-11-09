// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Signing in, the Subsonic token every request carries, and the settings that
// reset what the plugin remembers.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  apiRequests,
  assertAuth,
  bundleSkip,
  errorCode,
  loadPlugin,
  md5,
  oneRequest,
  requestsOf,
  throwsAsync,
} from "./helpers.mjs";

const CREDENTIALS = { username: "alice", password: "s3cret" };

function authNames(req) {
  return { u: req.params.u, s: req.params.s, t: req.params.t, v: req.params.v, c: req.params.c, f: req.params.f };
}

describe("sign in and auth", { skip: bundleSkip() }, () => {
  test("signIn pings the server and answers the account", async () => {
    const { plugin, requests } = await loadPlugin();
    const account = await plugin.signIn();
    assert.deepEqual(account, { id: "alice", name: "alice" }, "signIn answers the server account");
    const ping = oneRequest(requests, "ping");
    assertAuth(ping, CREDENTIALS);
  });

  test("every request carries the Subsonic signed token, not the password", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.signIn();
    await plugin.search({ query: "night", kind: "tracks" });
    await plugin.home();
    assert.ok(requests.length >= 3, "the plugin made several requests");
    for (const req of requests) {
      assertAuth(req, CREDENTIALS);
      assert.ok(!("p" in req.params), `${req.apiMethod}: no p= (encrypted password) parameter`);
      const wire = req.url;
      assert.ok(!wire.includes(CREDENTIALS.password), `${req.apiMethod}: the password never goes on the wire`);
      assert.equal(req.params.t, md5(CREDENTIALS.password + req.params.s), `${req.apiMethod}: the token is md5(password+salt)`);
    }
  });

  test("the salt is new for each API request", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.search({ query: "first", kind: "tracks" });
    await plugin.search({ query: "second", kind: "tracks" });
    const searches = apiRequests(requests, "search3");
    assert.equal(searches.length, 2, "two searches happened");
    assert.notEqual(searches[0].params.s, searches[1].params.s, "each API request mints a fresh salt");
    for (const req of searches) assertAuth(req, CREDENTIALS);
  });

  test("the password is sent as it is, spaces and all, in the token", async () => {
    const { plugin, requests } = await loadPlugin({ settings: { password: " p@ss word " } });
    await plugin.signIn();
    const ping = oneRequest(requests, "ping");
    assertAuth(ping, { username: "alice", password: " p@ss word " });
    assert.equal(ping.params.t, md5(" p@ss word " + ping.params.s), "the password isn't trimmed for the token");
  });

  test("account answers null until the settings are filled in, without a request", async () => {
    const { plugin, requests } = await loadPlugin({ settings: { server: "" } });
    assert.equal(await plugin.account(), null, "no server, no account");
    assert.equal(requests.length, 0, "account doesn't ask a server it doesn't have");
  });

  test("account answers who the settings say, without a request", async () => {
    const good = await loadPlugin();
    assert.deepEqual(await good.plugin.account(), { id: "alice", name: "alice" }, "the configured account");
    assert.equal(good.requests.length, 0, "Navidrome has no session to check, so account asks nothing");
  });

  test("missing settings are setup errors, before any request", async () => {
    for (const [label, settings, expected] of [
      ["server", { server: "" }, /server/i],
      ["username", { username: "" }, /username/i],
      ["password", { password: "" }, /password/i],
    ]) {
      const { plugin, requests } = await loadPlugin({ settings });
      const error = await throwsAsync(() => plugin.signIn(), `${label}: signIn rejects`);
      assert.equal(errorCode(error), "setup", `${label}: signIn is a setup error`);
      assert.match(error.message, expected, `${label}: the message says what to fill in`);
      assert.equal(requests.length, 0, `${label}: no request goes to an unconfigured server`);
    }
  });

  test("base URL: https for a bare host, one slash, trailing slashes trimmed, subpath kept", async () => {
    const cases = [
      ["https://music.example.com/", "https://music.example.com/rest/search3"],
      ["https://music.example.com", "https://music.example.com/rest/search3"],
      ["music.example.com", "https://music.example.com/rest/search3"],
      ["https://example.com/navidrome/", "https://example.com/navidrome/rest/search3"],
      ["http://192.168.1.10:4533", "http://192.168.1.10:4533/rest/search3"],
    ];
    for (const [server, expected] of cases) {
      const { plugin, requests } = await loadPlugin({ settings: { server } });
      await plugin.search({ query: "x", kind: "tracks" });
      const search = oneRequest(requests, "search3");
      assert.equal(search.pathname, new URL(expected).pathname, `${server}: the /rest path is right`);
      assert.equal(`${search.urlObject.origin}${search.pathname}`, expected, `${server}: the request URL is ${expected}`);
      assert.ok(!search.pathname.includes("//"), `${server}: no doubled slash`);
    }
  });

  test("cover and stream URLs keep one token for the session; a new sign-in mints another", async () => {
    const { plugin } = await loadPlugin();
    const page = await plugin.album({ id: "album-1" });
    const firstCover = page.album.imageUrl;
    const secondPage = await plugin.album({ id: "album-1" });
    assert.equal(secondPage.album.imageUrl, firstCover, "the same cover URL is reused, so the app's cache hits");

    const streamed = await plugin.stream({ id: "song-2", quality: "lossless" });
    const coverAuth = new URL(firstCover).searchParams;
    const streamAuth = new URL(streamed.url).searchParams;
    assert.equal(streamAuth.get("s"), coverAuth.get("s"), "covers and audio share the session's media salt");
    assert.equal(streamAuth.get("t"), coverAuth.get("t"), "covers and audio share the session's media token");
    assertAuth({ params: Object.fromEntries(streamAuth), apiMethod: "stream" }, CREDENTIALS);

    plugin.signOut();
    const after = await plugin.album({ id: "album-1" });
    const afterAuth = new URL(after.album.imageUrl).searchParams;
    assert.notEqual(afterAuth.get("s"), coverAuth.get("s"), "signing out forgets the media token");
    assertAuth({ params: Object.fromEntries(afterAuth), apiMethod: "getCoverArt" }, CREDENTIALS);
  });

  test("signOut forgets the starred cache", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.isLiked({ ids: ["song-1"] });
    await plugin.isLiked({ ids: ["song-1"] });
    assert.equal(apiRequests(requests, "getStarred2").length, 1, "likes are cached between calls");
    plugin.signOut();
    await plugin.isLiked({ ids: ["song-1"] });
    assert.equal(apiRequests(requests, "getStarred2").length, 2, "signing out drops the cache, so the next call asks again");
  });

  test("setSetting resets the caches it makes stale", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.isLiked({ ids: ["song-1"] });
    plugin.setSetting({ key: "server", value: "https://other.example.com" });
    // The host mock still answers the old server, which is fine: what matters
    // is that the plugin asked again.
    await plugin.isLiked({ ids: ["song-1"] });
    assert.equal(apiRequests(requests, "getStarred2").length, 2, "changing a setting drops the starred cache");
  });

  test("setSetting clears the recent list when the account changes, and keeps it otherwise", async () => {
    const accountChange = await loadPlugin();
    await accountChange.plugin.played({ id: "song-1" });
    assert.equal(accountChange.plugin.recent().length, 1, "the play was remembered");
    accountChange.plugin.setSetting({ key: "username", value: "bob" });
    assert.deepEqual(accountChange.plugin.recent(), [], "another account's recent list is empty");

    const cosmetic = await loadPlugin();
    await cosmetic.plugin.played({ id: "song-1" });
    cosmetic.plugin.setSetting({ key: "customHeaders", value: '{"X-A":"1"}' });
    assert.equal(cosmetic.plugin.recent().length, 1, "an unrelated setting keeps the recent list");
  });

  test("auth parameters have the exact wire names", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.like({ id: "song-1", on: true });
    const star = oneRequest(requests, "star");
    const params = authNames(star);
    assert.deepEqual(Object.keys(params).sort(), ["c", "f", "s", "t", "u", "v"], "u, t, s, v, c and f, no aliases");
    assert.equal(star.params.c, "mygo-music-navidrome", "the client name identifies the plugin");
    assert.equal(star.params.v, "1.16.1", "the Subsonic API version");
    assert.equal(star.params.f, "json", "JSON is requested");
  });
});
