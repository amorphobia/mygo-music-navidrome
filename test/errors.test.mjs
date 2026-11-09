// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// What the app sees when the server, or something in front of it, refuses.
//
// Errors thrown with a code (signIn, setup, unavailable, unsupported) make the
// app act; anything else is shown as its message. The Cloudflare cases must
// tell the listener to fill in the service token.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  apiRequests,
  bundleSkip,
  errorCode,
  loadPlugin,
  throwsAsync,
} from "./helpers.mjs";

const setup = (answer) => async () => answer;

async function loadedWith(answer) {
  const { plugin, requests } = await loadPlugin({ route: setup(answer) });
  return { plugin, requests };
}

describe("setup errors", { skip: bundleSkip() }, () => {
  test("no server is a setup error that says to fill it in", async () => {
    const { plugin, requests } = await loadPlugin({ settings: { server: "" } });
    for (const [name, call] of [
      ["home", () => plugin.home()],
      ["search", () => plugin.search({ query: "x", kind: "tracks" })],
      ["liked", () => plugin.liked({ offset: 0 })],
      ["browse", () => plugin.browse({ page: "albums" })],
    ]) {
      const error = await throwsAsync(call, `${name}: rejects`);
      assert.equal(errorCode(error), "setup", `${name}: it's a setup error`);
      assert.match(error.message, /server/i, `${name}: the message says the server is missing`);
    }
    assert.equal(requests.length, 0, "nothing was fetched");
  });

  test("no account is a setup error that says to fill in the credentials", async () => {
    for (const settings of [{ username: "" }, { password: "" }]) {
      const { plugin } = await loadPlugin({ settings });
      const error = await throwsAsync(() => plugin.home());
      assert.equal(errorCode(error), "setup");
      assert.match(error.message, /username/i, "the message says to fill in the account");
      assert.match(error.message, /password/i, "both parts of it");
    }
  });
});

describe("the server refuses", { skip: bundleSkip() }, () => {
  // The plugin's credentials are settings, so a refusal is a setup problem:
  // the app opens the plugin's settings and shows this message, where "signIn"
  // would open a sign-in window that can't ask for a server or a token.
  test("HTTP 401 is a setup error that says the credentials were rejected", async () => {
    const { plugin } = await loadedWith({ status: 401 });
    const error = await throwsAsync(() => plugin.home());
    assert.equal(errorCode(error), "setup", "401 opens the plugin's settings");
    assert.notEqual(errorCode(error), "signIn", "not the sign-in window that can't hold these settings");
    assert.match(error.message, /username or password/i, "the message says the credentials were rejected");
  });

  test("HTTP 403 is a setup error that mentions Cloudflare Access and the service token", async () => {
    const { plugin } = await loadedWith({ status: 403 });
    const error = await throwsAsync(() => plugin.search({ query: "x", kind: "tracks" }));
    assert.equal(errorCode(error), "setup", "403 opens the plugin's settings");
    assert.match(error.message, /Cloudflare Access/i, "the message names Cloudflare Access");
    assert.match(error.message, /Service Auth|service token/i, "and the service-token policy");
    assert.match(error.message, /Client ID/i, "and the setting to fill in");
  });

  test("a web page from Cloudflare instead of Subsonic data says what to do", async () => {
    const loginPage =
      '<!DOCTYPE html><html><head><title>Sign in · Cloudflare Access</title></head><body>cloudflare</body></html>';
    const { plugin } = await loadedWith({ html: loginPage });
    const error = await throwsAsync(() => plugin.home());
    assert.equal(errorCode(error), "setup", "an HTML login page means the plugin isn't getting through");
    assert.match(error.message, /web page/i, "the message says it got a page");
    assert.match(error.message, /Cloudflare Access/i, "and points at Cloudflare Access");
  });

  test("a web page with a 403 is also a setup error with the Cloudflare hint", async () => {
    const { plugin } = await loadedWith({ status: 403, html: "<html>denied</html>" });
    const error = await throwsAsync(() => plugin.signIn());
    assert.equal(errorCode(error), "setup");
    assert.match(error.message, /Cloudflare Access/i);
  });

  test("Subsonic error 40 is a rejected setup, with the server's reason", async () => {
    const { plugin } = await loadedWith({
      "subsonic-response": {
        status: "failed",
        version: "1.16.1",
        error: { code: 40, message: "Wrong username or password" },
      },
    });
    const error = await throwsAsync(() => plugin.home());
    assert.equal(errorCode(error), "setup", "error 40 opens the plugin's settings");
    assert.match(error.message, /Wrong username or password/, "the server's reason is shown");
  });

  test("Subsonic error 50 is a setup error too", async () => {
    const { plugin } = await loadedWith({
      "subsonic-response": {
        status: "failed",
        version: "1.16.1",
        error: { code: 50, message: "Not authorized" },
      },
    });
    const error = await throwsAsync(() => plugin.liked({ offset: 0 }));
    assert.equal(errorCode(error), "setup", "a refusal of the token opens the settings");
  });
});

describe("server and transport errors", { skip: bundleSkip() }, () => {
  test("an album the server can't find is a plain error with its reason", async () => {
    const { plugin } = await loadedWith({
      "subsonic-response": {
        status: "failed",
        version: "1.16.1",
        error: { code: 70, message: "Album not found" },
      },
    });
    const error = await throwsAsync(() => plugin.album({ id: "gone" }));
    assert.equal(errorCode(error), undefined, "a missing album isn't one of the app's codes");
    assert.match(error.message, /server reported an error/i, "the message says the server reported it");
    assert.match(error.message, /Album not found/, "with the server's reason");
  });

  test("a generic Subsonic failure is a plain error", async () => {
    const { plugin } = await loadedWith({
      "subsonic-response": {
        status: "failed",
        version: "1.16.1",
        error: { code: 0, message: "Something broke" },
      },
    });
    const error = await throwsAsync(() => plugin.signIn());
    assert.equal(errorCode(error), undefined);
    assert.match(error.message, /Something broke/, "the server's message is shown");
  });

  test("an HTTP server error is a plain error naming the status", async () => {
    const { plugin } = await loadedWith({ status: 500, text: "boom" });
    const error = await throwsAsync(() => plugin.signIn());
    assert.equal(errorCode(error), undefined, "a 500 isn't something the app acts on");
    assert.match(error.message, /server reported an error/i);
    assert.match(error.message, /500/, "the status is named");
  });

  test("an answer that isn't Subsonic data says the address may be wrong", async () => {
    const { plugin } = await loadedWith({ json: { hello: "not subsonic" } });
    const error = await throwsAsync(() => plugin.home());
    assert.equal(errorCode(error), undefined);
    assert.match(error.message, /Subsonic data/i, "the message says it didn't get Subsonic data");
    assert.match(error.message, /address/i, "and to check the address");
  });

  test("a network failure says the server couldn't be reached", async () => {
    const { plugin } = await loadPlugin({
      route: () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await throwsAsync(() => plugin.signIn());
    assert.equal(errorCode(error), undefined, "a network failure isn't a sign-in problem");
    assert.match(error.message, /Could not reach the server/i, "the message says so");
  });

  test("an error never repeats the password or the service secret", async () => {
    const settings = {
      password: "hunter2-secret",
      cfAccessClientId: "cf-id-1",
      cfAccessClientSecret: "cf-supersecret-2",
      customHeaders: '{"X-Api-Key":"api-secret-3"}',
    };
    for (const answer of [
      { status: 403 },
      { status: 401 },
      { html: "<html>no</html>" },
      { status: 500, text: "boom" },
    ]) {
      const { plugin } = await loadPlugin({ settings, route: setup(answer) });
      const error = await throwsAsync(() => plugin.signIn());
      for (const secret of ["hunter2-secret", "cf-supersecret-2", "api-secret-3"]) {
        assert.ok(!error.message.includes(secret), `${JSON.stringify(answer)}: the error doesn't leak ${secret}`);
      }
    }
  });
});

describe("unavailable and unsupported", { skip: bundleSkip() }, () => {
  test("there is no such browse page", async () => {
    const { plugin } = await loadPlugin();
    for (const page of ["nope", "albums:nope:0"]) {
      const error = await throwsAsync(() => plugin.browse({ page }));
      assert.equal(errorCode(error), "unavailable", `${page}: the app shows an unavailable page`);
      assert.match(error.message, /page/i, "the message says there is no such page");
    }
  });

  test("a missing album, artist or playlist is unavailable", async () => {
    const { plugin } = await loadPlugin({
      route: () => ({
        "subsonic-response": { status: "ok", version: "1.16.1" },
      }),
    });
    for (const [name, call] of [
      ["album", () => plugin.album({ id: "gone" })],
      ["artist", () => plugin.artist({ id: "gone" })],
      ["playlist", () => plugin.playlist({ id: "gone" })],
    ]) {
      const error = await throwsAsync(call, `${name}: rejects`);
      assert.equal(errorCode(error), "unavailable", `${name}: nothing to show means unavailable`);
    }
  });

  test("a song with no lyrics is unavailable after trying both endpoints", async () => {
    const { plugin, requests } = await loadPlugin();
    const error = await throwsAsync(() => plugin.lyrics({ id: "song-4" }));
    assert.equal(errorCode(error), "unavailable", "no lyrics is an unavailable error");
    assert.ok(apiRequests(requests, "getLyricsBySongId").length >= 1, "OpenSubsonic lyrics were tried");
    assert.ok(apiRequests(requests, "getLyrics").length >= 1, "then the older endpoint");
    assert.match(error.message, /lyrics/i, "the message says the song has none");
  });
});
