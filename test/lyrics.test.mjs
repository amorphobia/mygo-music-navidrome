// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Lyrics: OpenSubsonic timed lines, unsynced words as LRC, and the older
// getLyrics fallback.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  apiRequests,
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

describe("lyrics", { skip: bundleSkip() }, () => {
  test("timed lines become MyGo lyric lines in milliseconds", async () => {
    const { plugin, requests } = await loadPlugin();
    const lyrics = await plugin.lyrics({ id: "song-1" });
    const request = oneRequest(requests, "getLyricsBySongId");
    assert.equal(request.params.id, "song-1", "the song id goes to getLyricsBySongId");
    assert.deepEqual(
      lyrics.lines,
      [
        { start: 0, text: "First line" },
        { start: 3000, text: "Second line" },
      ],
      "the timed lines are kept, in milliseconds",
    );
    assert.equal(lyrics.lrc, undefined, "timed lines are used instead of LRC");
  });

  test("unsynced words come back as LRC", async () => {
    const { plugin, requests } = await loadPlugin();
    const lyrics = await plugin.lyrics({ id: "song-2" });
    assert.equal(apiRequests(requests, "getSong").length, 0, "an unsynced answer is words already, no fallback");
    assert.equal(lyrics.lrc, "Unsynced first\nUnsynced second", "the words are joined as plain LRC");
    assert.equal(lyrics.lines, undefined, "no timed lines");
  });

  test("the older getLyrics endpoint is the fallback", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getLyricsBySongId: () => ({
        "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 10, message: "Not supported" } },
      }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    const lyrics = await plugin.lyrics({ id: "song-5" });
    const request = oneRequest(requests, "getLyrics");
    assert.equal(request.params.artist, "Other Band", "getLyrics is asked by artist");
    assert.equal(request.params.title, "Nightfall Eyes", "and title");
    assert.equal(lyrics.lrc, "Plain first\nPlain second", "the LRC comes back");
  });

  test("setup problems are not swallowed", async () => {
    const missing = await loadPlugin({ settings: { server: "" } });
    const setupError = await throwsAsync(() => missing.plugin.lyrics({ id: "song-1" }));
    assert.equal(errorCode(setupError), "setup", "missing settings are a setup error");

    const refused = await loadPlugin({ route: () => ({ status: 401 }) });
    const refusedError = await throwsAsync(() => refused.plugin.lyrics({ id: "song-1" }));
    assert.equal(errorCode(refusedError), "setup", "a refused server opens the plugin's settings");
  });

  test("a song with no lyrics anywhere is unavailable", async () => {
    const { plugin } = await loadPlugin();
    const error = await throwsAsync(() => plugin.lyrics({ id: "song-4" }));
    assert.equal(errorCode(error), "unavailable");
    assert.match(error.message, /lyrics/i);
  });
});
