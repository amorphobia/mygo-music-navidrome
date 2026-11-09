// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Custom HTTP headers: the reason this plugin exists.
//
// The plugin's own fetch calls (the API) carry them directly. Covers are
// fetched by MyGo Music itself, through plugin.json's requestHeaders (tested in
// manifest.test.mjs); stream URLs get their headers handed to the app in the
// stream result.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertAuth,
  bundleSkip,
  errorCode,
  loadPlugin,
  oneRequest,
  throwsAsync,
} from "./helpers.mjs";

const CF_SETTINGS = {
  cfAccessClientId: "cf-id-123",
  cfAccessClientSecret: "cf-secret-456",
};

function requestHeaders(req) {
  return req.headers;
}

describe("custom headers", { skip: bundleSkip() }, () => {
  test("the Cloudflare Access service token goes on every API request", async () => {
    const { plugin, requests } = await loadPlugin({ settings: CF_SETTINGS });
    await plugin.search({ query: "night", kind: "tracks" });
    await plugin.home();
    assert.ok(requests.length >= 2, "several API requests happened");
    for (const req of requests) {
      assert.equal(req.header("CF-Access-Client-Id"), "cf-id-123", `${req.apiMethod}: CF client id`);
      assert.equal(req.header("CF-Access-Client-Secret"), "cf-secret-456", `${req.apiMethod}: CF client secret`);
      assert.equal(req.header("Accept"), "application/json", `${req.apiMethod}: the API answers JSON`);
      assert.equal(req.header("Authorization"), null, `${req.apiMethod}: no Authorization unless set`);
      assert.equal(req.header("Cookie"), null, `${req.apiMethod}: no Cookie unless set`);
    }
    for (const req of requests) {
      assert.ok(!req.url.includes("cf-secret-456"), `${req.apiMethod}: the secret never goes into the URL`);
    }
  });

  test("Authorization and Cookie go when the listener set them", async () => {
    const { plugin, requests } = await loadPlugin({
      settings: { authorization: "Bearer token-abc", cookie: "session=xyz" },
    });
    await plugin.signIn();
    const ping = oneRequest(requests, "ping");
    assert.equal(ping.header("Authorization"), "Bearer token-abc", "the Authorization header is sent");
    assert.equal(ping.header("Cookie"), "session=xyz", "the Cookie header is sent");
  });

  test("no auth headers at all when no setting is filled in", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.signIn();
    const ping = oneRequest(requests, "ping");
    const headers = requestHeaders(ping);
    assert.deepEqual(Object.keys(headers), ["accept"], "only Accept: application/json, nothing else");
  });

  test("customHeaders JSON adds arbitrary headers to API requests", async () => {
    const customHeaders = JSON.stringify({
      "X-Api-Key": "key-9",
      "X-Number": 42,
      "X-Flag": true,
      "X-Empty": "",
    });
    const { plugin, requests } = await loadPlugin({ settings: { customHeaders } });
    await plugin.signIn();
    const ping = oneRequest(requests, "ping");
    assert.equal(ping.header("x-api-key"), "key-9", "a string header is sent as is");
    assert.equal(ping.header("x-number"), "42", "a number is sent as its text");
    assert.equal(ping.header("x-flag"), "true", "a boolean is sent as its text");
    assert.equal(ping.header("x-empty"), "", "an empty string header is still sent");
  });

  test("customHeaders that would break the request are ignored", async () => {
    const customHeaders = JSON.stringify({
      Host: "evil.example.com",
      "Content-Length": "10",
      Connection: "keep-alive",
      "Bad Name": "space is not a header name",
      "X-Multi": ["a", "b"],
      "X-Newline": "a\r\nX-Evil: 1",
      "X-Good": "kept",
    });
    const { plugin, requests } = await loadPlugin({ settings: { customHeaders } });
    await plugin.signIn();
    const ping = oneRequest(requests, "ping");
    assert.equal(ping.header("host"), null, "Host can't be set by the listener");
    assert.equal(ping.header("content-length"), null, "Content-Length can't be set by the listener");
    assert.equal(ping.header("connection"), null, "Connection can't be set by the listener");
    assert.equal(ping.header("bad name"), null, "an invalid header name is dropped");
    assert.equal(ping.header("x-multi"), null, "an array value is dropped");
    assert.equal(ping.header("x-newline"), null, "a header value with a line break is dropped");
    assert.equal(ping.header("x-good"), "kept", "the valid header still goes");
  });

  test("invalid customHeaders is a clear setup error, with no request", async () => {
    for (const bad of ['{"a": ', "[]", '"a string"', "null", "42"]) {
      const { plugin, requests } = await loadPlugin({ settings: { customHeaders: bad } });
      const error = await throwsAsync(
        () => plugin.search({ query: "x", kind: "tracks" }),
        `customHeaders ${JSON.stringify(bad)}: search rejects`,
      );
      assert.equal(errorCode(error), "setup", `customHeaders ${JSON.stringify(bad)}: it's a setup error`);
      assert.match(error.message, /headers/i, "the message names the headers setting");
      assert.match(error.message, /JSON/i, "the message says it must be JSON");
      assert.equal(requests.length, 0, "nothing is fetched with unreadable headers");
    }
  });

  test("invalid customHeaders is also a setup error for stream()", async () => {
    const { plugin } = await loadPlugin({ settings: { customHeaders: "{oops" } });
    // getSong is asked first: it fails on the headers before any fetch.
    const error = await throwsAsync(() => plugin.stream({ id: "song-1", quality: "high" }));
    assert.equal(errorCode(error), "setup", "stream() rejects with setup when its headers are unreadable");
    assert.match(error.message, /JSON/i, "the message says the value must be JSON");
  });

  test("stream() hands the app the same auth headers, and no Accept", async () => {
    const { plugin } = await loadPlugin({
      settings: {
        ...CF_SETTINGS,
        authorization: "Bearer stream-token",
        cookie: "sid=1",
        customHeaders: JSON.stringify({ "X-Api-Key": "key-9" }),
      },
    });
    const stream = await plugin.stream({ id: "song-1", quality: "high" });
    assert.equal(stream.headers["CF-Access-Client-Id"], "cf-id-123", "the CF client id goes with the audio");
    assert.equal(stream.headers["CF-Access-Client-Secret"], "cf-secret-456", "the CF secret goes with the audio");
    assert.equal(stream.headers.Authorization, "Bearer stream-token", "the Authorization header goes with the audio");
    assert.equal(stream.headers.Cookie, "sid=1", "the Cookie header goes with the audio");
    assert.equal(stream.headers["X-Api-Key"], "key-9", "extra headers go with the audio");
    assert.ok(!("Accept" in stream.headers), "the audio isn't an API JSON call, so no Accept header");
  });

  test("stream headers are empty when there is nothing to send", async () => {
    const { plugin } = await loadPlugin();
    const stream = await plugin.stream({ id: "song-1", quality: "high" });
    assert.deepEqual(stream.headers, {}, "no headers are invented");
  });

  test("a cover URL is a getCoverArt request with the auth token and the {size} placeholder", async () => {
    const { plugin } = await loadPlugin();
    const page = await plugin.album({ id: "album-1" });
    const imageUrl = page.album.imageUrl;
    assert.ok(imageUrl, "the album with coverArt has an image URL");
    const url = new URL(imageUrl);
    assert.equal(url.origin, "https://music.example.com", "the cover comes from the server");
    assert.equal(url.pathname, "/rest/getCoverArt", "the cover is a getCoverArt request");
    assert.equal(url.searchParams.get("id"), "al-1", "the cover id is the album's coverArt id");
    assert.equal(url.searchParams.get("size"), "{size}", "the app fills in the size it shows");
    assertAuth(
      { params: Object.fromEntries(url.searchParams), apiMethod: "getCoverArt" },
      { username: "alice", password: "s3cret" },
    );
  });

  test("imageUrl is empty when there is no cover art", async () => {
    const { plugin } = await loadPlugin();
    const page = await plugin.album({ id: "album-3" });
    assert.equal(page.album.imageUrl, "", "an album without coverArt has no image URL");
    assert.equal(page.tracks[0].album.imageUrl, "", "its tracks have none either");
    const tracks = await plugin.search({ query: "Ape", kind: "tracks" });
    const noCover = tracks.tracks.find((track) => track.id === "song-3");
    assert.equal(noCover.album.imageUrl, "", "a song without coverArt has no album image URL");

    const lists = await plugin.playlists();
    const noCoverPlaylist = lists.find((playlist) => playlist.id === "playlist-2");
    assert.equal(noCoverPlaylist.imageUrl, "", "a playlist without coverArt has no image URL");
    const withCover = lists.find((playlist) => playlist.id === "playlist-1");
    assert.ok(withCover.imageUrl.includes("getCoverArt"), "a playlist with coverArt has one");
  });

  test("the plugin uses the global fetch, which is what MyGo provides", async () => {
    const harness = await loadPlugin();
    let called = false;
    globalThis.fetch = async (...args) => {
      called = true;
      return harness.fetch(...args);
    };
    try {
      await harness.plugin.signIn();
      assert.ok(called, "the plugin called the global fetch");
    } finally {
      globalThis.fetch = harness.fetch;
    }
  });
});
