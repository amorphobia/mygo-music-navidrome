// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// What the plugin exports: MyGo Music's plugin API, and only that.
//
// The app's Can(name) is decided by which functions the module exports, so the
// export list is the plugin's feature list. It must be exactly the contract's:
// a source with no playlist reorder, no podcasts and no stations.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bundleSkip, loadPlugin } from "./helpers.mjs";

const EXPECTED = [
  "account",
  "addToPlaylist",
  "album",
  "artist",
  "browse",
  "createPlaylist",
  "deletePlaylist",
  "followArtist",
  "home",
  "isLiked",
  "like",
  "liked",
  "lyrics",
  "movePlaylistTrack",
  "played",
  "playlist",
  "playlists",
  "recent",
  "removeFromPlaylist",
  "renamePlaylist",
  "saveAlbum",
  "savedAlbums",
  "search",
  "setSetting",
  "signIn",
  "signOut",
  "stream",
  "suggest",
].sort();

const NOT_EXPORTED = [
  "savePlaylist",
  "subscribeShow",
  "shows",
  "show",
  "stations",
  "stationNext",
  "comments",
  "likeComment",
  "postComment",
  "likeEpisode",
  "remotePlay",
  "remotePause",
  "remoteResume",
  "remoteSeek",
  "remoteVolume",
  "remoteState",
  "remoteDevices",
  "remoteUse",
];

describe("plugin exports", { skip: bundleSkip() }, () => {
  test("exports exactly the documented functions", async () => {
    const { plugin } = await loadPlugin();
    const functions = Object.keys(plugin)
      .filter((name) => typeof plugin[name] === "function")
      .sort();
    assert.deepEqual(functions, EXPECTED, "the export list is exactly MyGo's plugin API for this source");
  });

  test("every export is a function that takes one params object", async () => {
    const { plugin } = await loadPlugin();
    for (const name of EXPECTED) {
      assert.equal(typeof plugin[name], "function", `${name} is exported`);
      assert.ok(plugin[name].length <= 1, `${name} takes at most one params object (got ${plugin[name].length})`);
    }
  });

  test("does not export what this source can't do", async () => {
    const { plugin } = await loadPlugin();
    for (const name of NOT_EXPORTED) {
      assert.equal(plugin[name], undefined, `${name} isn't exported: the plugin doesn't do that`);
    }
  });

  test("the async functions answer a promise", async () => {
    const { plugin } = await loadPlugin();
    for (const name of ["signIn", "search", "home", "browse", "stream", "liked", "createPlaylist"]) {
      const result = plugin[name](name === "search" ? { query: "x", kind: "tracks" } : name === "browse" ? { page: "albums" } : name === "stream" ? { id: "song-1" } : name === "liked" ? { offset: 0 } : name === "createPlaylist" ? { name: "x" } : {});
      assert.ok(result instanceof Promise, `${name} is async`);
      await result.catch(() => {});
    }
  });

  test("the local actions answer at once", async () => {
    const { plugin } = await loadPlugin();
    assert.equal(plugin.account() instanceof Promise, false, "account reads the settings and answers");
    assert.equal(plugin.setSetting({ key: "server", value: "x" }), undefined, "setSetting is synchronous");
    assert.equal(plugin.signOut(), undefined, "signOut is synchronous");
    assert.ok(Array.isArray(plugin.recent()), "recent is synchronous");
  });
});
