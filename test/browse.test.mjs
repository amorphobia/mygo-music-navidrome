// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Home and the Browse pages the plugin makes up: albums by type, artists by
// index letter, and the playlists.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALBUM_BASE,
  apiRequests,
  bundleSkip,
  errorCode,
  loadPlugin,
  makeDb,
  makeRoutes,
  ok,
  overrideRoute,
  sectionItems,
  sectionTitles,
  throwsAsync,
} from "./helpers.mjs";

const ALBUM_TYPES = ["newest", "recent", "frequent", "alphabeticalByName"];

const manyAlbums = (count) =>
  Array.from({ length: count }, (_, index) => ({
    ...ALBUM_BASE,
    id: `page-${index}`,
    name: `Page Album ${index}`,
    created: new Date(2024, 0, index + 1).toISOString(),
    coverArt: `page-cover-${index}`,
    starred: undefined,
  }));

function listRequests(requests) {
  return apiRequests(requests, "getAlbumList2").map((req) => req.params);
}

describe("home", { skip: bundleSkip() }, () => {
  test("home() makes the sections MyGo shows, in order", async () => {
    const { plugin, requests } = await loadPlugin();
    const home = await plugin.home();

    assert.ok(home && Array.isArray(home.sections), "home answers a Browse with sections");
    assert.deepEqual(
      sectionTitles(home),
      [
        "Random picks",
        "Recently added",
        "Recently played",
        "Most played",
        "Favorite albums",
        "Favorite artists",
        "Playlists",
      ],
      "the sections come in the documented order",
    );

    const random = home.sections[0];
    assert.equal(random.tracks.length, 3, "the first section is random tracks");
    assert.equal(random.tracks[0].id, "song-2", "tracks are mapped from the server's random songs");
    assert.equal(random.tracks[0].duration, 302000, "and their duration is in milliseconds");
    assert.ok(random.pageTitle, "the random section opens a page of its own");
    assert.ok(random.subtitle, "and says what it is");

    const albumSections = [
      ["Recently added", "albums:newest:18"],
      ["Recently played", "albums:recent:18"],
      ["Most played", "albums:frequent:18"],
      ["Favorite albums", "albums:starred:18"],
    ];
    for (const [title, morePage] of albumSections) {
      const section = home.sections.find((item) => item.title === title);
      assert.ok(section, `the ${title} section exists`);
      assert.ok(section.albums.length > 0, `the ${title} section lists albums`);
      assert.equal(section.morePage, morePage, `the ${title} section opens its more page`);
      assert.equal(typeof section.albums[0].imageUrl, "string", "albums are mapped with their images");
    }

    const favoriteArtists = home.sections.find((section) => section.title === "Favorite artists");
    assert.deepEqual(
      favoriteArtists.artists.map((artist) => artist.name),
      ["The Rays"],
      "the followed artists are listed",
    );

    const playlists = home.sections.find((section) => section.title === "Playlists");
    assert.equal(playlists.playlists.length, 2, "the playlists are listed");
    assert.equal(playlists.playlists[0].mine, true, "with mine/saved mapped");

    const randomRequest = requests.find((req) => req.apiMethod === "getRandomSongs");
    assert.equal(randomRequest.params.size, "20", "home asks for 20 random songs");
    const lists = listRequests(requests);
    assert.equal(lists.length, 4, "home asks for four album lists");
    assert.deepEqual(
      lists.map((params) => params.type).sort(),
      ["frequent", "newest", "recent", "starred"],
      "the four list types",
    );
    for (const params of lists) {
      assert.equal(params.size, "18", "a home album section holds 18");
      assert.equal(params.offset, "0", "from the top");
    }
    assert.ok(requests.some((req) => req.apiMethod === "getStarred2"), "home asks what is starred");
    assert.ok(requests.some((req) => req.apiMethod === "getPlaylists"), "home asks for the playlists");
  });

  test("home() doesn't fail when an optional list does", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getRandomSongs: () => ({ "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 0, message: "no random" } } }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const home = await plugin.home();
    assert.ok(home.sections.length > 0, "the other sections are still shown");
    assert.ok(!home.sections.some((section) => section.title === "Random picks"), "the failed random section is left out");
  });

  test("home() carries a credentials refusal up to the app", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), { getStarred2: () => ({ status: 401 }) });
    const { plugin } = await loadPlugin({ db, route });
    const error = await throwsAsync(() => plugin.home());
    assert.equal(errorCode(error), "setup", "a refusal in home opens the plugin's settings");
  });

  test("home() works on an empty library", async () => {
    const db = makeDb();
    db.songs = [];
    db.albums = [];
    db.artists = [];
    db.starred = { songs: [], albums: [], artists: [] };
    db.randomSongs = [];
    db.recentAlbumIds = [];
    db.frequentAlbumIds = [];
    db.playlists = [];
    const { plugin } = await loadPlugin({ db });
    const home = await plugin.home();
    assert.ok(home.sections.length >= 4, "the page still makes sense");
    assert.ok(!home.sections.some((section) => section.title === "Random picks"), "no random section when there is nothing");
    assert.ok(!home.sections.some((section) => section.title === "Favorite artists"), "no favorite artists section");
    const playlists = home.sections.find((section) => section.title === "Playlists");
    assert.equal(playlists.playlists, undefined, "no playlists...");
    assert.ok(playlists.empty, "...but the section says so");
  });
});

describe("albums browse page", { skip: bundleSkip() }, () => {
  test('browse("albums") is the albums landing page', async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.browse({ page: "albums" });
    assert.deepEqual(
      sectionTitles(page),
      ["Recently added", "Recently played", "Most played", "All albums"],
      "the landing page offers the four ways in",
    );
    assert.equal(page.title, "Albums", "the page is titled");
    const lists = listRequests(requests);
    assert.equal(lists.length, 4, "one album list per section");
    assert.deepEqual(lists.map((params) => params.type).sort(), [...ALBUM_TYPES].sort(), "the four list types");
    for (const params of lists) assert.equal(params.size, "18", "each section shows 18");
    for (const section of page.sections) {
      assert.match(section.morePage, /^albums:[A-Za-z]+:18$/, `the ${section.title} section pages on from 18`);
    }
  });

  test('browse("albums:<type>:<offset>") pages one list', async () => {
    const albums = manyAlbums(25);
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getAlbumList2: (req) => {
        if (req.params.size !== "50") return undefined;
        const offset = Number(req.params.offset || 0);
        return ok({ albumList2: { album: albums.slice(offset, offset + Number(req.params.size)) } });
      },
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    const page = await plugin.browse({ page: "albums:newest:18" });
    const request = requests.find((req) => req.apiMethod === "getAlbumList2" && req.params.size === "50");
    assert.equal(request.params.type, "newest", "the list type comes from the page id");
    assert.equal(request.params.size, "50", "a list page holds 50");
    assert.equal(request.params.offset, "18", "the offset comes from the page id");
    assert.equal(page.sections.length, 1, "one section for one list");
    assert.equal(page.sections[0].title, "Recently added", "titled by the list type");
    assert.equal(page.sections[0].albums.length, 7, "the albums at that offset are mapped");
    assert.equal(page.sections[0].albums[0].name, "Page Album 18", "and they are the right ones");
    assert.equal(page.sections[0].morePage, undefined, "a short page has no more page");
  });

  test("a full list page says where the next one is", async () => {
    const albums = manyAlbums(50);
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getAlbumList2: (req) => {
        if (req.params.type === "newest" && req.params.size === "50") {
          return ok({ albumList2: { album: albums } });
        }
        return undefined;
      },
    });
    const { plugin } = await loadPlugin({ db, route });
    const page = await plugin.browse({ page: "albums:newest:18" });
    assert.equal(page.sections[0].albums.length, 50, "a full page");
    assert.equal(page.sections[0].morePage, "albums:newest:68", "the next page starts at 18 + 50");
  });

  test("an empty list page says it is empty", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getAlbumList2: () => ok({ albumList2: { album: [] } }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const page = await plugin.browse({ page: "albums:newest:0" });
    assert.equal(page.sections[0].albums.length, 0, "no albums");
    assert.ok(page.sections[0].empty, "the section says it is empty");
  });

  test("an unknown album list type or page is an unavailable error", async () => {
    const { plugin } = await loadPlugin();
    for (const page of ["albums:bogus:0", "albums:newest", "albums:newest:abc", "nope"]) {
      const error = await throwsAsync(() => plugin.browse({ page }), `browse(${JSON.stringify(page)}) rejects`);
      assert.equal(errorCode(error), "unavailable", `${page}: there is no such page`);
    }
  });
});

describe("artists browse page", { skip: bundleSkip() }, () => {
  test('browse("artists") lists the server index letters', async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.browse({ page: "artists" });
    assert.ok(requests.some((req) => req.apiMethod === "getArtists"), "the artist list comes from getArtists");
    assert.equal(page.title, "Artists");
    assert.deepEqual(
      sectionTitles(page),
      ["O", "S", "T"],
      "one section per index letter the server gave",
    );
    for (const section of page.sections) {
      assert.ok(section.artists.length > 0, `the ${section.title} section lists artists`);
      for (const artist of section.artists) {
        assert.equal(typeof artist.name, "string", "artists are mapped with their names");
        // artist-1 is starred, so the one followed artist is followed.
        assert.equal(artist.following, artist.id === "artist-1", `${artist.name}: following follows the starred field`);
      }
    }
    const all = sectionItems(page, "artists");
    assert.ok(all.some((artist) => artist.name === "The Rays"), "The Rays are under T");
  });

  test("an empty artist list says so", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getArtists: () => ok({ artists: { index: [] } }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const page = await plugin.browse({ page: "artists" });
    assert.equal(page.sections.length, 1);
    assert.equal(page.sections[0].title, "Artists");
    assert.ok(page.sections[0].empty, "the section says there are no artists");
  });
});

describe("playlists browse page", { skip: bundleSkip() }, () => {
  test('browse("playlists") separates mine from saved', async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.browse({ page: "playlists" });
    assert.ok(requests.some((req) => req.apiMethod === "getPlaylists"), "the page lists playlists");
    assert.equal(page.title, "Playlists");
    assert.deepEqual(sectionTitles(page), ["My playlists", "Saved playlists"]);
    const mine = page.sections[0].playlists;
    assert.deepEqual(mine.map((playlist) => playlist.id), ["playlist-1"], "only the listener's own");
    const saved = page.sections[1].playlists;
    assert.deepEqual(saved.map((playlist) => playlist.id), ["playlist-2"], "and the ones they saved");
  });

  test("saved playlists are left out when there are none", async () => {
    const db = makeDb();
    db.playlists = db.playlists.filter((playlist) => playlist.owner === "alice");
    const { plugin } = await loadPlugin({ db });
    const page = await plugin.browse({ page: "playlists" });
    assert.deepEqual(sectionTitles(page), ["My playlists"], "no saved section");
  });

  test("an empty own list says so", async () => {
    const db = makeDb();
    db.playlists = [];
    const { plugin } = await loadPlugin({ db });
    const page = await plugin.browse({ page: "playlists" });
    assert.deepEqual(sectionTitles(page), ["My playlists"]);
    assert.equal(page.sections[0].playlists.length, 0);
    assert.ok(page.sections[0].empty, "the section says there are no playlists yet");
  });
});

describe("browse fallbacks", { skip: bundleSkip() }, () => {
  test('browse("") opens home', async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.browse({ page: "" });
    assert.equal(page.sections[0].title, "Random picks", "an empty page id is Home");
    assert.ok(requests.some((req) => req.apiMethod === "getRandomSongs"), "home was built");
  });
});
