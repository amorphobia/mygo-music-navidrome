// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Played tracks: the local recent list, and the optional scrobble.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SONG_BASE,
  apiRequests,
  bundleSkip,
  loadPlugin,
  makeDb,
  makeRoutes,
  ok,
  overrideRoute,
} from "./helpers.mjs";

const RECENT_KEY = "recentTracks";

function storedRecent(harness) {
  return harness.host.__dumpStorage()[RECENT_KEY];
}

function manySongs(count) {
  return Array.from({ length: count }, (_, index) => ({
    ...SONG_BASE,
    id: `track-${index}`,
    title: `Track ${index}`,
  }));
}

describe("recent listening list", { skip: bundleSkip() }, () => {
  test("played() remembers the track locally, without scrobbling by default", async () => {
    const { plugin, requests } = await loadPlugin();
    assert.deepEqual(plugin.recent(), [], "nothing played yet");
    await plugin.played({ id: "song-1" });
    assert.equal(apiRequests(requests, "getSong").length, 1, "the track's details are fetched once");
    assert.equal(apiRequests(requests, "scrobble").length, 0, "scrobbling is off unless asked for");
  });

  test("played() keeps the track in host.storage under recentTracks", async () => {
    const harness = await loadPlugin();
    await harness.plugin.played({ id: "song-1" });
    const stored = storedRecent(harness);
    assert.ok(Array.isArray(stored), "the recent list is an array in host.storage");
    assert.equal(stored.length, 1, "with the one track");
    assert.equal(stored[0].id, "song-1", "the track is stored as MyGo's shape");
    assert.equal(stored[0].duration, 245000, "including its duration in milliseconds");
    assert.ok(
      harness.storageOps.some((op) => op.op === "set" && op.key === RECENT_KEY),
      "the plugin wrote host.storage.set('recentTracks', ...)",
    );
  });

  test("recent() answers newest first", async () => {
    const { plugin } = await loadPlugin();
    await plugin.played({ id: "song-1" });
    await plugin.played({ id: "song-2" });
    const recent = plugin.recent();
    assert.deepEqual(
      recent.map((track) => track.id),
      ["song-2", "song-1"],
      "the last played track is first",
    );
    assert.equal(recent[0].name, "Second Wind", "tracks come back shaped, not as bare ids");
  });

  test("played() drops the older copy of a track that plays again", async () => {
    const { plugin } = await loadPlugin();
    await plugin.played({ id: "song-1" });
    await plugin.played({ id: "song-2" });
    await plugin.played({ id: "song-1" });
    const ids = plugin.recent().map((track) => track.id);
    assert.deepEqual(ids, ["song-1", "song-2"], "no duplicates, newest first");
  });

  test("the recent list keeps only the last fifty", async () => {
    const songs = manySongs(60);
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getSong: (req) => ok({ song: songs.find((song) => song.id === req.params.id) }),
    });
    const harness = await loadPlugin({ db, route });
    for (const song of songs) await harness.plugin.played({ id: song.id });
    const recent = harness.plugin.recent();
    assert.equal(recent.length, 50, "the ring holds fifty tracks");
    assert.equal(recent[0].id, "track-59", "newest first");
    assert.equal(recent[49].id, "track-10", "the oldest kept one");
    assert.equal(storedRecent(harness).length, 50, "host.storage holds fifty too");
  });

  test("played() reuses a track shape already mapped on a page", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.search({ query: "First Light", kind: "tracks" });
    const getSongsBefore = apiRequests(requests, "getSong").length;
    await plugin.played({ id: "song-1" });
    assert.equal(
      apiRequests(requests, "getSong").length,
      getSongsBefore,
      "a track already mapped costs no getSong request",
    );
    assert.equal(plugin.recent()[0].id, "song-1", "and it was remembered");
  });

  test("the recent list survives a plugin restart", async () => {
    const first = await loadPlugin();
    await first.plugin.played({ id: "song-2" });
    const storage = first.host.__dumpStorage();

    const second = await loadPlugin({ storage });
    assert.equal(second.requests.length, 0, "recent() needs no server");
    const recent = second.plugin.recent();
    assert.equal(recent.length, 1, "the list was kept");
    assert.equal(recent[0].id, "song-2", "with the stored track");
    assert.equal(recent[0].name, "Second Wind");
  });

  test("changing the server, username or password clears the recent list", async () => {
    for (const key of ["server", "username", "password"]) {
      const harness = await loadPlugin();
      await harness.plugin.played({ id: "song-1" });
      assert.equal(harness.plugin.recent().length, 1, `${key}: the play was remembered`);
      harness.plugin.setSetting({ key, value: "changed" });
      assert.deepEqual(harness.plugin.recent(), [], `${key}: another server or account has no recent list`);
    }
  });

  test("played() with nothing to remember does nothing quietly", async () => {
    const missingSettings = await loadPlugin({ settings: { server: "" } });
    assert.equal(await missingSettings.plugin.played({ id: "song-1" }), undefined);
    assert.equal(missingSettings.requests.length, 0, "no server, nothing happens");

    const emptyId = await loadPlugin();
    assert.equal(await emptyId.plugin.played({ id: "" }), undefined);
    assert.equal(emptyId.requests.length, 0, "no id, nothing happens");
  });

  test("played() doesn't fail when the track can't be looked up", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getSong: () => ({
        "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 70, message: "Song not found" } },
      }),
    });
    const harness = await loadPlugin({ db, route });
    await harness.plugin.played({ id: "gone" });
    assert.deepEqual(harness.plugin.recent(), [], "nothing to remember, and no exception");
  });
});

describe("scrobbling", { skip: bundleSkip() }, () => {
  test("the scrobble setting turns it on", async () => {
    for (const truthy of ["true", "1", "yes", "on", "TRUE"]) {
      const harness = await loadPlugin({ settings: { scrobble: truthy } });
      await harness.plugin.played({ id: "song-1" });
      const scrobbles = apiRequests(harness.requests, "scrobble");
      assert.equal(scrobbles.length, 1, `scrobble=${truthy}: one scrobble`);
      const params = scrobbles[0].params;
      assert.equal(params.id, "song-1", "the track id");
      assert.equal(params.submission, "true", "a submission, not a now-playing");
      assert.match(String(params.time), /^\d+$/, "with a millisecond timestamp");
      const time = Number(params.time);
      assert.ok(Math.abs(Date.now() - time) < 60_000, "the timestamp is now");
    }
  });

  test("falsy and unset scrobble settings keep it off", async () => {
    for (const falsy of ["", "false", "0", "no", "off", "maybe"]) {
      const harness = await loadPlugin({ settings: { scrobble: falsy } });
      await harness.plugin.played({ id: "song-1" });
      assert.equal(apiRequests(harness.requests, "scrobble").length, 0, `scrobble=${JSON.stringify(falsy)}: no scrobble`);
      assert.equal(harness.plugin.recent().length, 1, "but the local recent list is still kept");
    }
  });

  test("a failed scrobble doesn't interrupt playback", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      scrobble: () => ({ status: 500, text: "boom" }),
    });
    const harness = await loadPlugin({ db, route, settings: { scrobble: "true" } });
    await harness.plugin.played({ id: "song-1" });
    assert.equal(harness.plugin.recent().length, 1, "the track is still remembered");
  });

  test("the recent list is kept even while scrobbling is on", async () => {
    const { plugin } = await loadPlugin({ settings: { scrobble: "true" } });
    await plugin.played({ id: "song-2" });
    assert.equal(plugin.recent()[0].id, "song-2", "local recent works with the server history too");
  });
});
