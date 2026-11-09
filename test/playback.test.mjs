// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Playing audio: the quality mapping, the formats MyGo can decode, and the
// URL and headers the app plays.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SONG_BASE,
  assertAuth,
  bundleSkip,
  errorCode,
  loadPlugin,
  makeDb,
  makeRoutes,
  ok,
  oneRequest,
  overrideRoute,
  throwsAsync,
} from "./helpers.mjs";

const CREDENTIALS = { username: "alice", password: "s3cret" };
const ALLOWED_TYPES = ["mp3", "flac", "ogg", "wav", "m4a", "aac"];

function queryOf(stream) {
  return new URL(stream.url).searchParams;
}

async function streamed(id, quality) {
  const harness = await loadPlugin();
  return { stream: await harness.plugin.stream({ id, quality }), harness };
}

describe("stream quality and format", { skip: bundleSkip() }, () => {
  test("default and high quality are mp3 at 320", async () => {
    for (const quality of [undefined, "high"]) {
      const { stream, harness } = await streamed("song-1", quality);
      const request = oneRequest(harness.requests, "getSong");
      assert.equal(request.params.id, "song-1", "the source format is read from getSong");
      assert.equal(stream.type, "mp3");
      assert.ok(ALLOWED_TYPES.includes(stream.type), "the type is one MyGo decodes");
      const query = queryOf(stream);
      assert.equal(new URL(stream.url).pathname, "/rest/stream", "it is a stream URL");
      assert.equal(query.get("id"), "song-1", "for the track");
      assert.equal(query.get("format"), "mp3", "high quality transcodes to mp3");
      assert.equal(query.get("maxBitRate"), "320", "at 320 kbps");
      assertAuth({ params: Object.fromEntries(query), apiMethod: "stream" }, CREDENTIALS);
    }
  });

  test("standard quality is mp3 at 128", async () => {
    const { stream } = await streamed("song-1", "standard");
    assert.equal(stream.type, "mp3");
    const query = queryOf(stream);
    assert.equal(query.get("format"), "mp3");
    assert.equal(query.get("maxBitRate"), "128", "standard asks the server for 128 kbps");
  });

  test("standard quality still transcodes a lossless source to mp3", async () => {
    const { stream } = await streamed("song-2", "standard");
    assert.equal(stream.type, "mp3", "a FLAC source at standard quality is mp3");
    assert.equal(queryOf(stream).get("maxBitRate"), "128");
  });

  test("lossless asks for the raw file when MyGo can decode the source", async () => {
    const flac = await streamed("song-2", "lossless");
    assert.equal(flac.stream.type, "flac", "a FLAC source stays FLAC");
    const flacQuery = queryOf(flac.stream);
    assert.equal(flacQuery.get("format"), "raw", "raw means no transcoding");
    assert.equal(flacQuery.get("maxBitRate"), null, "raw has no bit rate cap");

    const m4a = await streamed("song-5", "lossless");
    assert.equal(m4a.stream.type, "m4a", "an M4A source stays M4A");
    assert.equal(queryOf(m4a.stream).get("format"), "raw", "raw again");
  });

  test("the type follows the source format, not the URL", async () => {
    const cases = [
      ["song-1", "mp3"],
      ["song-2", "flac"],
      ["song-5", "m4a"],
      ["song-7", "wav"],
    ];
    for (const [id, type] of cases) {
      const { stream } = await streamed(id, "lossless");
      assert.equal(stream.type, type, `${id}: the source suffix decides the type`);
    }
  });

  test("formats MyGo can't decode are transcoded to mp3 320 even at lossless", async () => {
    for (const [id, name] of [
      ["song-3", "APE"],
      ["song-4", "WMA"],
      ["song-6", "Opus in Ogg"],
      ["song-8", "AIFF"],
    ]) {
      const { stream } = await streamed(id, "lossless");
      assert.equal(stream.type, "mp3", `${name}: an undecodable source is mp3`);
      const query = queryOf(stream);
      assert.equal(query.get("format"), "mp3", `${name}: transcoded to mp3`);
      assert.equal(query.get("maxBitRate"), "320", `${name}: at 320, never labelled lossless`);
    }
  });

  test("an unrecognised quality is treated as high", async () => {
    const { stream } = await streamed("song-1", "ultra");
    assert.equal(stream.type, "mp3");
    assert.equal(queryOf(stream).get("maxBitRate"), "320");
  });
});

describe("stream headers and URLs", { skip: bundleSkip() }, () => {
  test("the stream URL and headers carry what a proxied server needs", async () => {
    const { plugin } = await loadPlugin({
      settings: {
        cfAccessClientId: "cf-id",
        cfAccessClientSecret: "cf-secret",
        authorization: "Bearer t",
        cookie: "sid=1",
        customHeaders: '{"X-Api-Key":"k"}',
      },
    });
    const stream = await plugin.stream({ id: "song-1", quality: "high" });
    const query = queryOf(stream);
    assert.equal(query.get("u"), "alice", "the Subsonic username is in the URL");
    assert.ok(query.get("s"), "the salt is in the URL");
    assert.ok(query.get("t"), "the token is in the URL");
    assert.equal(query.get("v"), "1.16.1");
    assert.equal(query.get("c"), "mygo-music-navidrome");
    assert.equal(query.get("f"), "json");
    assert.equal(stream.headers["CF-Access-Client-Id"], "cf-id");
    assert.equal(stream.headers["CF-Access-Client-Secret"], "cf-secret");
    assert.equal(stream.headers.Authorization, "Bearer t");
    assert.equal(stream.headers.Cookie, "sid=1");
    assert.equal(stream.headers["X-Api-Key"], "k");
  });

  test("the media token is reused for the whole session", async () => {
    const { plugin } = await loadPlugin();
    const first = await plugin.stream({ id: "song-1", quality: "high" });
    const second = await plugin.stream({ id: "song-1", quality: "high" });
    const firstQuery = queryOf(first);
    const secondQuery = queryOf(second);
    assert.equal(secondQuery.get("s"), firstQuery.get("s"), "the same salt, so the app's cache hits");
    assert.equal(secondQuery.get("t"), firstQuery.get("t"), "and the same token");
  });
});

describe("stream failures", { skip: bundleSkip() }, () => {
  test("a song the server says is gone is unavailable", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getSong: () => ({ "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 70, message: "Song not found" } } }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const error = await throwsAsync(() => plugin.stream({ id: "gone", quality: "high" }));
    assert.equal(errorCode(error), "unavailable", "a missing song can't be played");
    assert.match(error.message, /Song not found/, "the server's reason is passed on");
  });

  test("an empty getSong answer is unavailable", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), { getSong: () => ok({}) });
    const { plugin } = await loadPlugin({ db, route });
    const error = await throwsAsync(() => plugin.stream({ id: "empty", quality: "high" }));
    assert.equal(errorCode(error), "unavailable");
    assert.match(error.message, /track/i, "the message says the track isn't on the server");
  });

  test("a video is unavailable, with a clear reason", async () => {
    const db = makeDb();
    const video = { ...SONG_BASE, id: "video-1", isVideo: true, title: "A Video" };
    const route = overrideRoute(makeRoutes(db), { getSong: () => ok({ song: video }) });
    const { plugin } = await loadPlugin({ db, route });
    const error = await throwsAsync(() => plugin.stream({ id: "video-1", quality: "high" }));
    assert.equal(errorCode(error), "unavailable", "MyGo can't play a video");
    assert.match(error.message, /video/i, "and the message says why");
  });

  test("stream needs the settings, like everything else", async () => {
    const { plugin, requests } = await loadPlugin({ settings: { server: "" } });
    const error = await throwsAsync(() => plugin.stream({ id: "song-1", quality: "high" }));
    assert.equal(errorCode(error), "setup");
    assert.equal(requests.length, 0, "no request without a server");
  });
});
