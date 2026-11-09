// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// The library pages — album, artist, playlist — and the listener's likes,
// saved albums and followed artists.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALBUM_BASE,
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

const manySongs = (count) =>
  Array.from({ length: count }, (_, index) => ({
    ...SONG_BASE,
    id: `liked-${index}`,
    title: `Liked Song ${index}`,
    track: index + 1,
  }));

const manyAlbums = (count) =>
  Array.from({ length: count }, (_, index) => ({
    ...ALBUM_BASE,
    id: `saved-${index}`,
    name: `Saved Album ${index}`,
    coverArt: `saved-cover-${index}`,
  }));

describe("album page", { skip: bundleSkip() }, () => {
  test("album() maps getAlbum into an AlbumPage", async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.album({ id: "album-1" });
    const request = oneRequest(requests, "getAlbum");
    assert.equal(request.params.id, "album-1", "the album id goes to getAlbum");
    assertAuth(request, CREDENTIALS);

    assert.ok(page.album, "the answer has an album");
    assert.equal(page.album.id, "album-1");
    assert.equal(page.album.name, "Dawn");
    assert.equal(page.album.released, "2024", "the year is the released string");
    assert.equal(page.album.saved, true, "a starred album is saved");
    assert.deepEqual(page.album.artists, [{ id: "artist-1", name: "The Rays" }]);
    assert.match(page.album.imageUrl, /getCoverArt\?.*id=al-1/, "the album cover URL names its coverArt id");

    assert.equal(page.tracks.length, 2, "the album's songs are its tracks");
    assert.deepEqual(
      page.tracks.map((track) => track.id),
      ["song-1", "song-2"],
      "tracks are in server order",
    );
    assert.equal(page.tracks[0].duration, 245000, "duration is milliseconds");
    assert.equal(page.tracks[0].name, "First Light");
  });

  test("an album that isn't there is an unavailable error", async () => {
    const { plugin } = await loadPlugin({
      route: overrideRoute(makeRoutes(makeDb()), { getAlbum: () => ok({}) }),
    });
    const error = await throwsAsync(() => plugin.album({ id: "nope" }));
    assert.equal(errorCode(error), "unavailable", "a missing album can't be shown");
    assert.match(error.message, /album/i, "the message says the album isn't in the library");
  });
});

describe("artist page", { skip: bundleSkip() }, () => {
  test("artist() maps getArtist and asks for the top songs", async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.artist({ id: "artist-1" });
    assert.equal(oneRequest(requests, "getArtist").params.id, "artist-1", "the artist id goes to getArtist");
    const top = oneRequest(requests, "getTopSongs");
    assert.equal(top.params.artist, "The Rays", "top songs are asked for by the artist's name");
    assert.equal(top.params.count, "20", "a page of twenty top songs");

    assert.equal(page.artist.id, "artist-1");
    assert.equal(page.artist.name, "The Rays");
    assert.equal(page.artist.following, true, "a starred artist is followed");
    assert.match(page.artist.imageUrl, /getCoverArt\?/, "the artist has a picture");
    assert.equal(page.albums.length, 2, "the artist's albums are listed");
    assert.ok(page.albums.some((album) => album.name === "Slow Burn"), "all of the albums are there");
    assert.equal(page.tracks.length, 2, "the top songs are the artist page's tracks");
    assert.equal(page.tracks[0].id, "song-2");
  });

  test("the artist page still works when the server has no top songs", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getTopSongs: () => ({ "subsonic-response": { status: "failed", version: "1.16.1", error: { code: 0, message: "no Last.fm" } } }),
    });
    const { plugin } = await loadPlugin({ db, route });
    const page = await plugin.artist({ id: "artist-1" });
    assert.deepEqual(page.tracks, [], "no top songs, no tracks, no failure");
    assert.equal(page.albums.length, 2, "the albums are still there");
  });

  test("an artist that isn't there is unavailable", async () => {
    const { plugin } = await loadPlugin({
      route: overrideRoute(makeRoutes(makeDb()), { getArtist: () => ok({}) }),
    });
    const error = await throwsAsync(() => plugin.artist({ id: "nope" }));
    assert.equal(errorCode(error), "unavailable", "a missing artist can't be shown");
    assert.match(error.message, /artist/i, "the message says the artist isn't in the library");
  });
});

describe("playlists", { skip: bundleSkip() }, () => {
  test("playlists() lists mine and saved", async () => {
    const { plugin, requests } = await loadPlugin();
    const lists = await plugin.playlists();
    oneRequest(requests, "getPlaylists");
    assert.equal(lists.length, 2, "both playlists are listed");

    const mine = lists.find((playlist) => playlist.id === "playlist-1");
    assert.equal(mine.name, "Road Trip");
    assert.equal(mine.owner, "alice");
    assert.equal(mine.mine, true, "the listener's own playlist is mine");
    assert.equal(mine.saved, undefined, "mine isn't saved");
    assert.equal(mine.trackCount, 2, "the server's song count");
    assert.match(mine.imageUrl, /getCoverArt\?/, "the playlist cover URL");

    const saved = lists.find((playlist) => playlist.id === "playlist-2");
    assert.equal(saved.owner, "bob");
    assert.equal(saved.saved, true, "someone else's playlist is saved");
    assert.equal(saved.mine, undefined, "saved isn't mine");
    assert.equal(saved.imageUrl, "", "a playlist without coverArt has no image URL");
  });

  test("playlist() maps the page with its songs", async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.playlist({ id: "playlist-2" });
    assert.equal(oneRequest(requests, "getPlaylist").params.id, "playlist-2", "the playlist id goes to getPlaylist");
    assert.equal(page.id, "playlist-2");
    assert.equal(page.name, "Shared Mix");
    assert.equal(page.saved, true);
    assert.equal(page.trackCount, 1, "the track count is the server's");
    assert.equal(page.tracks.length, 1, "and the songs are the tracks");
    assert.equal(page.tracks[0].id, "song-5");
    assert.equal(page.tracks[0].name, "Nightfall Eyes");
  });

  test("a playlist that isn't there is unavailable", async () => {
    const { plugin } = await loadPlugin({
      route: overrideRoute(makeRoutes(makeDb()), { getPlaylist: () => ok({}) }),
    });
    const error = await throwsAsync(() => plugin.playlist({ id: "nope" }));
    assert.equal(errorCode(error), "unavailable", "a missing playlist can't be shown");
    assert.match(error.message, /playlist/i, "the message says it isn't on the server");
  });

  test("createPlaylist makes one and answers it", async () => {
    const { plugin, requests } = await loadPlugin();
    const playlist = await plugin.createPlaylist({ name: "  New List  " });
    const request = oneRequest(requests, "createPlaylist");
    assert.equal(request.params.name, "New List", "the name is trimmed and sent");
    assert.equal(request.params.songId, undefined, "a new playlist starts empty");
    assert.ok(playlist, "the made playlist is answered");
    assert.equal(playlist.name, "New List");
    assert.equal(playlist.mine, true, "the listener just made it");
  });

  test("createPlaylist finds the playlist when the server doesn't answer it", async () => {
    const db = makeDb();
    db.playlists.push({ id: "playlist-found", name: "Found Me", owner: "alice", songCount: 0 });
    const route = overrideRoute(makeRoutes(db), { createPlaylist: () => ok({}) });
    const { plugin, requests } = await loadPlugin({ db, route });
    const playlist = await plugin.createPlaylist({ name: "Found Me" });
    assert.ok(requests.some((req) => req.apiMethod === "getPlaylists"), "it lists playlists to find the new one");
    assert.equal(playlist.id, "playlist-found", "and answers the playlist it made");
  });

  test("renamePlaylist sends updatePlaylist with the new name", async () => {
    const { plugin, requests } = await loadPlugin();
    assert.equal(await plugin.renamePlaylist({ id: "playlist-1", name: "Trip" }), undefined);
    const request = oneRequest(requests, "updatePlaylist");
    assert.equal(request.params.playlistId, "playlist-1", "the playlist being renamed");
    assert.equal(request.params.name, "Trip", "the new name");
  });

  test("deletePlaylist deletes it", async () => {
    const { plugin, requests } = await loadPlugin();
    assert.equal(await plugin.deletePlaylist({ id: "playlist-2" }), undefined);
    assert.equal(oneRequest(requests, "deletePlaylist").params.id, "playlist-2", "the playlist id goes to deletePlaylist");
  });

  test("addToPlaylist appends every track id", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.addToPlaylist({ id: "playlist-1", trackIds: ["song-1", "song-2"] });
    const request = oneRequest(requests, "updatePlaylist");
    assert.equal(request.params.playlistId, "playlist-1");
    assert.deepEqual(request.paramValues("songIdToAdd"), ["song-1", "song-2"], "each song id is added, in order");

    const empty = await loadPlugin();
    await empty.plugin.addToPlaylist({ id: "playlist-1", trackIds: [] });
    assert.equal(empty.requests.length, 0, "adding nothing asks nothing");
  });

  test("removeFromPlaylist removes by fresh indices, from the end", async () => {
    const db = makeDb();
    const base = makeRoutes(db);
    const route = overrideRoute(base, {
      getPlaylist: () =>
        ok({
          playlist: {
            id: "playlist-1",
            name: "Road Trip",
            owner: "alice",
            songCount: 3,
            entry: [{ id: "song-1" }, { id: "song-2" }, { id: "song-1" }],
          },
        }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    await plugin.removeFromPlaylist({ id: "playlist-1", trackIds: ["song-1"] });
    oneRequest(requests, "getPlaylist");
    const request = oneRequest(requests, "updatePlaylist");
    assert.deepEqual(
      request.paramValues("songIndexToRemove"),
      ["2", "0"],
      "both copies are removed, highest index first so the earlier ones keep their places",
    );
  });

  test("removeFromPlaylist is a no-op when nothing matches", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.removeFromPlaylist({ id: "playlist-1", trackIds: ["song-3"] });
    oneRequest(requests, "getPlaylist");
    assert.equal(apiRequests(requests, "updatePlaylist").length, 0, "nothing to remove, no update");
  });

  test("movePlaylistTrack reorders by replacing the playlist's songs", async () => {
    const db = makeDb();
    const entries = [{ id: "song-1" }, { id: "song-2" }, { id: "song-3" }, { id: "song-5" }];
    const route = overrideRoute(makeRoutes(db), {
      getPlaylist: () =>
        ok({
          playlist: { id: "playlist-1", name: "Road Trip", owner: "alice", songCount: entries.length, entry: entries },
        }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    await plugin.movePlaylistTrack({ id: "playlist-1", from: 0, to: 2 });
    oneRequest(requests, "getPlaylist");
    const replace = oneRequest(requests, "createPlaylist");
    assert.equal(replace.params.playlistId, "playlist-1", "the playlist being reordered is named");
    assert.deepEqual(
      replace.paramValues("songId"),
      ["song-2", "song-3", "song-1", "song-5"],
      "the songs are replaced in their new order, all of them",
    );
  });

  test("movePlaylistTrack refuses positions that don't exist", async () => {
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getPlaylist: () =>
        ok({ playlist: { id: "playlist-1", name: "Road Trip", owner: "alice", songCount: 2, entry: [{ id: "song-1" }, { id: "song-2" }] } }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    for (const [from, to] of [
      [2, 0],
      [0, 2],
      [-1, 0],
    ]) {
      const error = await throwsAsync(() => plugin.movePlaylistTrack({ id: "playlist-1", from, to }));
      assert.equal(errorCode(error), "unavailable", `move ${from}->${to}: an impossible move can't be done`);
      assert.match(error.message, /position/i, "the message says the position doesn't exist");
    }
    assert.equal(apiRequests(requests, "createPlaylist").length, 0, "no reorder request was made");
  });

  test("movePlaylistTrack is a no-op for a song already in place", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.movePlaylistTrack({ id: "playlist-1", from: 1, to: 1 });
    oneRequest(requests, "getPlaylist");
    assert.equal(apiRequests(requests, "createPlaylist").length, 0, "same position, nothing to do");
  });

  test("movePlaylistTrack keeps very long playlists out of reach", async () => {
    const db = makeDb();
    const entries = Array.from({ length: 401 }, (_, index) => ({ id: `song-${index}` }));
    const route = overrideRoute(makeRoutes(db), {
      getPlaylist: () => ok({ playlist: { id: "playlist-1", name: "Long", owner: "alice", songCount: 401, entry: entries } }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });
    const error = await throwsAsync(() => plugin.movePlaylistTrack({ id: "playlist-1", from: 0, to: 1 }));
    assert.equal(errorCode(error), "unavailable", "a 401-song playlist is too long to replace in one URL");
    assert.match(error.message, /long/i, "the message says it is too long");
    assert.equal(apiRequests(requests, "createPlaylist").length, 0, "nothing was sent");
  });

  test("movePlaylistTrack on a playlist that isn't there is unavailable", async () => {
    const { plugin } = await loadPlugin({
      route: overrideRoute(makeRoutes(makeDb()), { getPlaylist: () => ok({}) }),
    });
    const error = await throwsAsync(() => plugin.movePlaylistTrack({ id: "gone", from: 0, to: 1 }));
    assert.equal(errorCode(error), "unavailable");
    assert.match(error.message, /playlist/i);
  });
});

describe("likes, saved albums and follows", { skip: bundleSkip() }, () => {
  test("liked() pages the starred songs", async () => {
    const { plugin, requests } = await loadPlugin();
    const page = await plugin.liked({ offset: 0 });
    oneRequest(requests, "getStarred2");
    assert.equal(page.tracks.length, 2, "the two starred songs");
    assert.deepEqual(
      page.tracks.map((track) => track.id),
      ["song-1", "song-2"],
      "in server order",
    );
    assert.equal(page.more, false, "fewer than a page, so no more");
  });

  test("liked() pages at fifty and pages through the cache", async () => {
    const likedSongs = manySongs(60);
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getStarred2: () => ok({ starred2: { song: likedSongs } }),
    });
    const { plugin, requests } = await loadPlugin({ db, route });

    const first = await plugin.liked({ offset: 0 });
    assert.equal(first.tracks.length, 50, "a page of liked songs holds 50");
    assert.equal(first.more, true, "a full page means more");

    const second = await plugin.liked({ offset: 50 });
    assert.equal(second.tracks.length, 10, "the rest");
    assert.equal(second.more, false, "then there is no more");
    assert.equal(apiRequests(requests, "getStarred2").length, 1, "both pages came from one starred answer, kept");
  });

  test("savedAlbums() asks getAlbumList2 for starred albums, 50 at a time", async () => {
    const { plugin, requests } = await loadPlugin();
    const list = await plugin.savedAlbums({ offset: 0 });
    const request = oneRequest(requests, "getAlbumList2");
    assert.equal(request.params.type, "starred", "saved albums are the starred album list");
    assert.equal(request.params.size, "50", "pages hold 50 albums");
    assert.equal(request.params.offset, "0", "the first page");
    assert.equal(list.albums.length, 1, "the one starred album");
    assert.equal(list.albums[0].id, "album-1");
    assert.equal(list.albums[0].saved, true, "it says saved");
    assert.equal(list.more, false, "a short page means no more");
  });

  test("savedAlbums() pages at fifty", async () => {
    const albums = manyAlbums(50);
    const db = makeDb();
    const route = overrideRoute(makeRoutes(db), {
      getAlbumList2: (req) => {
        const offset = Number(req.params.offset || 0);
        return ok({ albumList2: { album: offset === 0 ? albums : [] } });
      },
    });
    const { plugin } = await loadPlugin({ db, route });
    const first = await plugin.savedAlbums({ offset: 0 });
    assert.equal(first.albums.length, 50, "a full page of 50");
    assert.equal(first.more, true, "a full page means more");
    const second = await plugin.savedAlbums({ offset: 50 });
    assert.equal(second.albums.length, 0, "the second page is empty");
    assert.equal(second.more, false, "and there is no more");
  });

  test("isLiked answers a map for the ids shown", async () => {
    const { plugin, requests } = await loadPlugin();
    const liked = await plugin.isLiked({ ids: ["song-1", "song-3", "song-2"] });
    oneRequest(requests, "getStarred2");
    assert.deepEqual(liked, { "song-1": true, "song-3": false, "song-2": true }, "each id is liked or not");
  });

  test("like() stars and unstars, and forgets the cached likes", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.like({ id: "song-3", on: true });
    const star = oneRequest(requests, "star");
    assert.equal(star.params.id, "song-3", "the song id is starred");

    await plugin.like({ id: "song-3", on: false });
    const unstar = oneRequest(requests, "unstar");
    assert.equal(unstar.params.id, "song-3", "the song id is unstarred");

    await plugin.isLiked({ ids: ["song-3"] });
    const afterFirst = apiRequests(requests, "getStarred2").length;
    await plugin.isLiked({ ids: ["song-3"] });
    assert.equal(apiRequests(requests, "getStarred2").length, afterFirst, "likes are cached");
    await plugin.like({ id: "song-5", on: true });
    await plugin.isLiked({ ids: ["song-5"] });
    assert.equal(apiRequests(requests, "getStarred2").length, afterFirst + 1, "a like drops the cache");
  });

  test("saveAlbum stars the album with albumId", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.saveAlbum({ id: "album-2", on: true });
    const star = oneRequest(requests, "star");
    // OpenSubsonic: star takes id for a song, albumId for an album, artistId
    // for an artist. Sending an album id as id stars no song.
    assert.equal(star.params.albumId, "album-2", "an album is saved with albumId");
    assert.equal(star.params.id, undefined, "an album id is not a song id");
  });

  test("followArtist stars the artist with artistId", async () => {
    const { plugin, requests } = await loadPlugin();
    await plugin.followArtist({ id: "artist-2", on: true });
    const star = oneRequest(requests, "star");
    assert.equal(star.params.artistId, "artist-2", "an artist is followed with artistId");
    assert.equal(star.params.id, undefined, "an artist id is not a song id");

    await plugin.followArtist({ id: "artist-2", on: false });
    const unstar = oneRequest(requests, "unstar");
    assert.equal(unstar.params.artistId, "artist-2", "and unfollowed with artistId");
  });
});
