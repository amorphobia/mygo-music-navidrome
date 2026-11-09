// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Search and its paging, and the Subsonic-to-MyGo mapping of what it finds.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SONG_BASE,
  apiRequests,
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

/** Songs a fake library has, for paging past one page. */
function manySongs(count) {
  return Array.from({ length: count }, (_, index) => ({
    ...SONG_BASE,
    id: `paged-${index}`,
    title: `Paged Song ${index}`,
    track: index + 1,
    coverArt: `cover-${index}`,
  }));
}

describe("search", { skip: bundleSkip() }, () => {
  test("tracks: a 30-song page, mapped to MyGo tracks", async () => {
    const { plugin, requests } = await loadPlugin();
    const result = await plugin.search({ query: "night", kind: "tracks" });
    const search = oneRequest(requests, "search3");
    assert.equal(search.params.query, "night", "the query is passed on");
    assert.equal(search.params.songCount, "30", "a track search page holds 30 songs");
    assert.equal(search.params.songOffset, "0", "the page starts at the offset asked for");
    assert.equal(search.params.albumCount, undefined, "a track search doesn't ask for albums");
    assertAuth(search, CREDENTIALS);

    assert.ok(Array.isArray(result.tracks), "the answer has tracks");
    assert.equal(result.tracks.length, 3, "all three Nightfall songs came back");
    assert.equal(result.more, false, "a page shorter than 30 says there is no more");

    const track = result.tracks.find((item) => item.id === "song-5");
    assert.ok(track, "song-5 is in the result");
    assert.equal(track.name, "Nightfall Eyes", "the title becomes the track name");
    assert.equal(track.duration, 210000, "Subsonic seconds are MyGo milliseconds");
    assert.deepEqual(track.artists, [{ id: "artist-2", name: "Other Band" }], "OpenSubsonic artists are kept");
    assert.ok(track.album && typeof track.album === "object", "a track always has an album");
    assert.equal(track.album.id, "album-2", "the album id");
    assert.equal(track.album.name, "Nightfall", "the album name");
    assert.match(track.album.imageUrl, /getCoverArt\?/, "the album's cover is a getCoverArt URL");
  });

  test("albums: a 30-album page of searchResult3 albums", async () => {
    const { plugin, requests } = await loadPlugin();
    const result = await plugin.search({ query: "night", kind: "albums" });
    const search = oneRequest(requests, "search3");
    assert.equal(search.params.albumCount, "30", "an album search page holds 30 albums");
    assert.equal(search.params.albumOffset, "0", "the album offset is passed on");
    assert.equal(search.params.songCount, undefined, "an album search doesn't ask for songs");
    assert.equal(result.albums.length, 1, "one album matched");
    const album = result.albums[0];
    assert.equal(album.id, "album-2");
    assert.equal(album.name, "Nightfall");
    assert.equal(album.released, "2023", "the year is MyGo's released string");
    assert.deepEqual(album.artists, [{ id: "artist-2", name: "Other Band" }]);
    assert.equal(album.saved, false, "a plain album isn't saved");
  });

  test("saved albums say saved, and follows say following", async () => {
    const { plugin } = await loadPlugin();
    const albums = await plugin.search({ query: "Dawn", kind: "albums" });
    assert.equal(albums.albums[0].saved, true, "a starred album is saved");
    const artists = await plugin.search({ query: "Rays", kind: "artists" });
    assert.equal(artists.artists.length, 1);
    assert.equal(artists.artists[0].name, "The Rays");
    assert.equal(artists.artists[0].following, true, "a starred artist is followed");
    assert.match(artists.artists[0].imageUrl, /getCoverArt\?/, "an artist has a picture");
  });

  test("paging: offset is forwarded, and a full page says more", async () => {
    const songs = manySongs(35);
    const db = makeDb();
    const base = makeRoutes(db);
    const route = overrideRoute(base, {
      search3: (req) => {
        const offset = Number(req.params.songOffset || 0);
        const count = Number(req.params.songCount || 30);
        return ok({ searchResult3: { song: songs.slice(offset, offset + count) } });
      },
    });
    const { plugin, requests } = await loadPlugin({ db, route });

    const first = await plugin.search({ query: "paged", kind: "tracks", offset: 0 });
    assert.equal(first.tracks.length, 30, "the first page is full");
    assert.equal(first.more, true, "a full page means there is a next one");

    const second = await plugin.search({ query: "paged", kind: "tracks", offset: 30 });
    assert.equal(second.tracks.length, 5, "the second page has the rest");
    assert.equal(second.more, false, "a short page means the end");
    const searches = apiRequests(requests, "search3");
    assert.deepEqual(
      searches.map((req) => req.params.songOffset),
      ["0", "30"],
      "each page asked the server for its own offset",
    );
  });

  test("the offset reaches the server as songOffset", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.search({ query: "x", kind: "tracks", offset: 60 });
    const search = oneRequest(requests, "search3");
    assert.equal(search.params.songOffset, "60", "the page offset goes to the server");
  });

  test("playlists are searched locally over getPlaylists", async () => {
    const { plugin, requests } = await loadPlugin();
    const result = await plugin.search({ query: "mix", kind: "playlists" });
    assert.equal(requests.filter((req) => req.apiMethod === "search3").length, 0, "playlist search doesn't ask search3");
    oneRequest(requests, "getPlaylists");
    assert.equal(result.playlists.length, 1, "only the matching playlist");
    assert.equal(result.playlists[0].name, "Shared Mix");
    assert.equal(result.playlists[0].saved, true, "someone else's playlist is saved");
  });

  test("an empty query answers nothing without a request", async () => {
    const { plugin, requests } = await loadPlugin();
    assert.deepEqual(await plugin.search({ query: "", kind: "tracks" }), { more: false }, "empty query, empty result");
    assert.equal(requests.length, 0, "nothing was fetched");
  });

  test("an unsupported kind is an unsupported error", async () => {
    const { plugin, requests } = await loadPlugin();
    const error = await throwsAsync(() => plugin.search({ query: "x", kind: "shows" }));
    assert.equal(errorCode(error), "unsupported", "shows aren't a search kind this source does");
    assert.match(error.message, /search/i, "the message says the search kind is unsupported");
    assert.equal(requests.length, 0, "no request for a kind the plugin can't search");
  });

  test("suggest asks for few of each kind and answers up to eight names", async () => {
    const { plugin, requests } = await loadPlugin();
    const names = await plugin.suggest({ query: "night" });
    const search = oneRequest(requests, "search3");
    assert.equal(search.params.songCount, "4", "up to four song names");
    assert.equal(search.params.albumCount, "3", "up to three album names");
    assert.equal(search.params.artistCount, "4", "up to four artist names");
    assert.ok(Array.isArray(names), "suggest answers a list");
    assert.ok(names.length > 0 && names.length <= 8, `at most eight suggestions (got ${names.length})`);
    assert.equal(new Set(names).size, names.length, "suggestions are unique");
    assert.ok(names.includes("Nightfall Eyes"), "a matching song title is suggested");
    assert.ok(names.includes("Nightfall"), "a matching album name is suggested");

    const empty = await loadPlugin();
    assert.deepEqual(await empty.plugin.suggest({ query: "" }), [], "an empty query suggests nothing");
    assert.equal(empty.requests.length, 0, "and asks nothing");
  });

  test("mapping: flat artist fields, missing album fields and video songs", async () => {
    const db = makeDb();
    const base = makeRoutes(db);
    const route = overrideRoute(base, {
      search3: () =>
        ok({
          searchResult3: {
            song: [
              {
                id: "flat-1",
                title: "Flat Song",
                artist: "Flat Artist",
                artistId: "flat-artist",
                album: "Flat Album",
                albumId: "flat-album",
                duration: 245.6,
                suffix: "mp3",
                contentType: "audio/mpeg",
                coverArt: "flat-cover",
                year: 2020,
                isVideo: true,
              },
              { id: "nameless-1", name: "Name Only" },
            ],
          },
        }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const result = await plugin.search({ query: "x", kind: "tracks" });
    const flat = result.tracks[0];
    assert.equal(flat.name, "Flat Song", "the title names the track");
    assert.deepEqual(flat.artists, [{ id: "flat-artist", name: "Flat Artist" }], "flat artist fields become an artists array");
    assert.equal(flat.duration, 245600, "seconds become milliseconds, rounded");
    assert.equal(flat.unavailable, true, "a video can't be played, and says so");
    assert.deepEqual(flat.album.artists, flat.artists, "the album credits the same artists");
    assert.equal(flat.album.released, "2020", "the album's year is its released string");

    const nameless = result.tracks[1];
    assert.equal(nameless.name, "Name Only", "a song with only name still gets a name");
    assert.equal(nameless.duration, 0, "a missing duration is zero");
    assert.ok(nameless.album && typeof nameless.album === "object", "the album object is always there");
    assert.equal(nameless.album.name, "", "even when it has no fields");
  });

  test("an empty library answers empty lists, not an error", async () => {
    const db = makeDb();
    db.songs = [];
    db.albums = [];
    db.artists = [];
    const { plugin } = await loadPlugin({ db });
    const tracks = await plugin.search({ query: "nothing", kind: "tracks" });
    assert.deepEqual(tracks.tracks, [], "no tracks found");
    assert.equal(tracks.more, false, "and no more pages");
    const albums = await plugin.search({ query: "nothing", kind: "albums" });
    assert.deepEqual(albums.albums, [], "no albums found");
    const artists = await plugin.search({ query: "nothing", kind: "artists" });
    assert.deepEqual(artists.artists, [], "no artists found");
  });
});
