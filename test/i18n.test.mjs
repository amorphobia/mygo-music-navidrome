// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Translations: every text the plugin can show, and everything plugin.json
// shows, has a Simplified Chinese translation, and host.t() is used for it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  BUNDLE_PATH,
  bundleSkip,
  loadPlugin,
  makeDb,
  makeRoutes,
  ok,
  overrideRoute,
  readLocale,
  readManifest,
  throwsAsync,
} from "./helpers.mjs";

/** Every string literal passed to the bundled t("…"), as English keys. */
function tLiterals(source) {
  const found = new Set();
  const pattern = /(?:^|[^\w$.])t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const match of source.matchAll(pattern)) {
    const literal = match[1];
    try {
      found.add(literal.startsWith('"') ? JSON.parse(literal) : literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\"));
    } catch {
      // A literal the scan can't read: the test below would notice it missing.
    }
  }
  return found;
}

async function swallow(promise) {
  try {
    await promise;
  } catch {
    // The error paths are the point: their messages are translated too.
  }
}

/** Run the plugin through every path that can show a text. */
async function exerciseTranslations() {
  const calls = new Set();
  const record = (harness) => {
    for (const text of harness.tCalls) calls.add(text);
  };

  // The happy paths of every page and action.
  {
    const harness = await loadPlugin();
    const { plugin } = harness;
    await plugin.signIn();
    await plugin.account();
    await swallow(plugin.home());
    await swallow(plugin.browse({ page: "albums" }));
    await swallow(plugin.browse({ page: "albums:newest:0" }));
    await swallow(plugin.browse({ page: "artists" }));
    await swallow(plugin.browse({ page: "playlists" }));
    for (const kind of ["tracks", "albums", "artists", "playlists"]) {
      await swallow(plugin.search({ query: "the", kind }));
    }
    await swallow(plugin.suggest({ query: "the" }));
    await swallow(plugin.album({ id: "album-1" }));
    await swallow(plugin.artist({ id: "artist-1" }));
    await swallow(plugin.liked({ offset: 0 }));
    await swallow(plugin.savedAlbums({ offset: 0 }));
    await swallow(plugin.playlists());
    await swallow(plugin.playlist({ id: "playlist-1" }));
    await swallow(plugin.createPlaylist({ name: "Translated" }));
    await swallow(plugin.renamePlaylist({ id: "playlist-1", name: "Renamed" }));
    await swallow(plugin.addToPlaylist({ id: "playlist-1", trackIds: ["song-1"] }));
    await swallow(plugin.removeFromPlaylist({ id: "playlist-1", trackIds: ["song-1"] }));
    await swallow(plugin.movePlaylistTrack({ id: "playlist-1", from: 0, to: 1 }));
    await swallow(plugin.deletePlaylist({ id: "playlist-2" }));
    await swallow(plugin.isLiked({ ids: ["song-1"] }));
    await swallow(plugin.like({ id: "song-1", on: true }));
    await swallow(plugin.saveAlbum({ id: "album-1", on: true }));
    await swallow(plugin.followArtist({ id: "artist-1", on: true }));
    await swallow(plugin.stream({ id: "song-1", quality: "high" }));
    await swallow(plugin.lyrics({ id: "song-1" }));
    await swallow(plugin.played({ id: "song-1" }));
    await swallow(plugin.recent());
    plugin.signOut();
    record(harness);
  }

  // The paths that fail, each with its own message.
  const failing = [
    ["setup server", { settings: { server: "" } }, (plugin) => plugin.home()],
    ["setup credentials", { settings: { username: "" } }, (plugin) => plugin.home()],
    [
      "bad custom headers",
      { settings: { customHeaders: "{not json" } },
      (plugin) => plugin.search({ query: "x", kind: "tracks" }),
    ],
    ["http 401", { route: () => ({ status: 401 }) }, (plugin) => plugin.home()],
    ["http 403", { route: () => ({ status: 403 }) }, (plugin) => plugin.home()],
    ["html page", { route: () => ({ html: "<html>Sign in</html>" }) }, (plugin) => plugin.home()],
    [
      "server failure",
      { route: () => ({ "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 0, message: "x" } } }) },
      (plugin) => plugin.signIn(),
    ],
    [
      "network",
      {
        route: () => {
          throw new TypeError("fetch failed");
        },
      },
      (plugin) => plugin.home(),
    ],
    ["not subsonic", { route: () => ({ json: { not: "subsonic" } }) }, (plugin) => plugin.home()],
    ["unsupported search", {}, (plugin) => plugin.search({ query: "x", kind: "shows" })],
    ["unknown page", {}, (plugin) => plugin.browse({ page: "no-such-page" })],
    [
      "missing album",
      { route: overrideRoute(makeRoutes(makeDb()), { getAlbum: () => ok({}) }) },
      (plugin) => plugin.album({ id: "gone" }),
    ],
    [
      "missing artist",
      { route: overrideRoute(makeRoutes(makeDb()), { getArtist: () => ok({}) }) },
      (plugin) => plugin.artist({ id: "gone" }),
    ],
    [
      "missing playlist",
      { route: overrideRoute(makeRoutes(makeDb()), { getPlaylist: () => ok({}) }) },
      (plugin) => plugin.playlist({ id: "gone" }),
    ],
    [
      "song gone",
      {
        route: overrideRoute(makeRoutes(makeDb()), {
          getSong: () => ({ "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 70, message: "" } } }),
        }),
      },
      (plugin) => plugin.stream({ id: "gone", quality: "high" }),
    ],
    ["empty song", { route: overrideRoute(makeRoutes(makeDb()), { getSong: () => ok({}) }) }, (plugin) => plugin.stream({ id: "gone" })],
    [
      "video",
      {
        route: overrideRoute(makeRoutes(makeDb()), {
          getSong: () => ok({ song: { id: "v", isVideo: true, title: "Video" } }),
        }),
      },
      (plugin) => plugin.stream({ id: "v", quality: "high" }),
    ],
    ["no lyrics", {}, (plugin) => plugin.lyrics({ id: "song-4" })],
    [
      "impossible move",
      {
        route: overrideRoute(makeRoutes(makeDb()), {
          getPlaylist: () => ok({ playlist: { id: "playlist-1", name: "Road Trip", owner: "alice", songCount: 1, entry: [{ id: "song-1" }] } }),
        }),
      },
      (plugin) => plugin.movePlaylistTrack({ id: "playlist-1", from: 0, to: 9 }),
    ],
    [
      "playlist too long",
      {
        route: overrideRoute(makeRoutes(makeDb()), {
          getPlaylist: () =>
            ok({
              playlist: {
                id: "playlist-1",
                name: "Long",
                owner: "alice",
                songCount: 401,
                entry: Array.from({ length: 401 }, (_, index) => ({ id: `song-${index}` })),
              },
            }),
        }),
      },
      (plugin) => plugin.movePlaylistTrack({ id: "playlist-1", from: 0, to: 1 }),
    ],
    [
      "playlist not returned",
      {
        route: (() => {
          const db = makeDb();
          db.playlists = [];
          return overrideRoute(makeRoutes(db), { createPlaylist: () => ok({}) });
        })(),
      },
      (plugin) => plugin.createPlaylist({ name: "Never Found" }),
    ],
  ];
  for (const [label, options, call] of failing) {
    const harness = await loadPlugin(options);
    await swallow(call(harness.plugin));
    record(harness);
    void label;
  }

  // The empty-state texts of every page.
  {
    const db = makeDb();
    db.songs = [];
    db.albums = [];
    db.artists = [];
    db.starred = { songs: [], albums: [], artists: [] };
    db.randomSongs = [];
    db.recentAlbumIds = [];
    db.frequentAlbumIds = [];
    db.playlists = [];
    db.artistIndex = [];
    const harness = await loadPlugin({ db });
    await swallow(harness.plugin.home());
    await swallow(harness.plugin.browse({ page: "albums:newest:0" }));
    await swallow(harness.plugin.browse({ page: "artists" }));
    await swallow(harness.plugin.browse({ page: "playlists" }));
    record(harness);
  }

  return calls;
}

describe("translations", { skip: bundleSkip() }, () => {
  test("every t() text in the bundle has a zh-CN translation", async () => {
    const bundle = readFileSync(BUNDLE_PATH, "utf8");
    const texts = tLiterals(bundle);
    assert.ok(texts.size >= 10, `the bundle has user-facing texts (found ${texts.size})`);
    const locale = readLocale("zh-CN");
    const missing = [...texts].filter((text) => typeof locale[text] !== "string" || !locale[text].trim());
    assert.deepEqual(missing, [], `every t() text is translated; missing: ${missing.join(" | ")}`);
  });

  test("every text host.t() is asked for during real use is translated", async () => {
    const calls = await exerciseTranslations();
    assert.ok(calls.size >= 20, `running the plugin asked for many texts (${calls.size})`);
    const locale = readLocale("zh-CN");
    const missing = [...calls].filter((text) => typeof locale[text] !== "string" || !locale[text].trim());
    assert.deepEqual(missing, [], `every runtime text is translated; missing: ${missing.join(" | ")}`);

    // The exercise must actually reach the interesting messages.
    for (const expected of [
      "There's no such page",
      "This kind of search isn't supported",
      "This song has no lyrics",
      "This track isn't on the server",
      "This is a video, which the player can't play",
      "This album isn't in the library",
      "This playlist isn't on the server",
      "You haven't made a playlist yet",
      "No artists in the library",
      "No albums here",
      "That song position doesn't exist in this playlist",
      "This playlist is too long to reorder from MyGo Music; reorder it in Navidrome",
      "The server made the playlist but didn't return it; reopen the playlists page",
    ]) {
      assert.ok(calls.has(expected), `the exercise reached ${JSON.stringify(expected)}`);
      assert.equal(typeof locale[expected], "string", `locale has ${JSON.stringify(expected)}`);
    }
  });

  test("everything the manifest shows is translated", async () => {
    const manifest = readManifest();
    const locale = readLocale("zh-CN");
    const missing = [];
    const need = (text, what) => {
      if (typeof locale[text] !== "string" || !locale[text].trim()) missing.push(`${what}: ${text}`);
    };
    need(manifest.name, "name");
    for (const setting of manifest.settings) {
      need(setting.label, `setting ${setting.key} label`);
      if (setting.help) need(setting.help, `setting ${setting.key} help`);
    }
    for (const item of manifest.navigation) {
      if (item.title) need(item.title, `navigation ${item.page}`);
    }
    assert.deepEqual(missing, [], `the manifest's texts are translated; missing: ${missing.join(" | ")}`);
  });

  test("with zh-CN the plugin shows Chinese, not English", async () => {
    const harness = await loadPlugin({ language: "zh-CN" });
    const { plugin, tCalls } = harness;
    const home = await plugin.home();
    const titles = home.sections.map((section) => section.title);
    assert.ok(titles.includes("随机推荐"), `the first section is translated (titles: ${titles.join(", ")})`);
    assert.ok(titles.includes("最近添加"), "the album sections are translated");
    assert.ok(!titles.includes("Random picks"), "no English section titles are left");
    assert.ok(tCalls.includes("Random picks"), "host.t was asked for the English key");
    assert.equal(home.sections[0].tracks[0].name, "Second Wind", "track names are data, not UI: they stay as the server has them");
  });

  test("failure messages are Chinese with zh-CN", async () => {
    const forbidden = await loadPlugin({ language: "zh-CN", route: () => ({ status: 403 }) });
    const forbiddenError = await throwsAsync(() => forbidden.plugin.home());
    assert.match(forbiddenError.message, /访问被拒绝/, "the 403 message is translated");
    assert.match(forbiddenError.message, /Cloudflare Access/, "and still names Cloudflare Access");

    const badHeaders = await loadPlugin({ language: "zh-CN", settings: { customHeaders: "{bad" } });
    const headersError = await throwsAsync(() => badHeaders.plugin.search({ query: "x", kind: "tracks" }));
    assert.match(headersError.message, /额外请求头/, "the headers message is translated");
    assert.match(headersError.message, /JSON/, "and still says JSON");

    const noServer = await loadPlugin({ language: "zh-CN", settings: { server: "" } });
    const setupError = await throwsAsync(() => noServer.plugin.signIn());
    assert.match(setupError.message, /插件设置/, "the setup message is translated");
    assert.equal(setupError.code, "setup", "the code is unchanged by translation");
  });
});
