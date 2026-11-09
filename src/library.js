// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// The library: searching it, the pages of an album, an artist and a playlist,
// the listener's likes, and the playlists they can change.
//
// Subsonic has no playlist reorder or partial-list page, so a few things are
// done the way the protocol allows: starred songs are fetched whole and the
// app pages through them here, and playlist edits are serialized from a fresh
// read of the playlist.

import { readConfig, requireAccount, scrobbleEnabled } from "./config.js";
import { invalidateCaches, likedAmong, recentTracks, rememberPlayed, starredSnapshot } from "./cache.js";
import { fail, unavailableFail, t } from "./errors.js";
import {
  entriesOf,
  toAlbum,
  toArtist,
  toPlaylist,
  toPlaylistPage,
  toTrack,
  trackShape,
} from "./mappers.js";
import {
  createPlaylist as createPlaylistOnServer,
  deletePlaylist as deletePlaylistOnServer,
  getAlbum,
  getAlbumList2,
  getArtist,
  getPlaylist,
  getPlaylists,
  getSong,
  getTopSongs,
  scrobble,
  search3,
  star,
  unstar,
  updatePlaylist,
} from "./subsonic.js";

/** How many things a search page holds. */
const SEARCH_PAGE = 30;
/** How many albums, or liked songs, a page holds. */
const LIST_PAGE = 50;

const songsIn = (response, key) => {
  const list = response && response[key];
  return Array.isArray(list) ? list : [];
};

/** Search tracks, albums, artists or playlists, a page at a time. */
export async function search({ query, kind, offset = 0 }) {
  requireAccount();
  const text = String(query || "");
  const start = Math.max(0, Number(offset) || 0);
  if (!text) return { more: false };
  if (kind === "tracks") {
    const response = await search3({ query: text, songCount: SEARCH_PAGE, songOffset: start });
    const songs = songsIn(response.searchResult3, "song");
    return { tracks: songs.map(toTrack), more: songs.length === SEARCH_PAGE };
  }
  if (kind === "albums") {
    const response = await search3({ query: text, albumCount: SEARCH_PAGE, albumOffset: start });
    const albums = songsIn(response.searchResult3, "album");
    return { albums: albums.map(toAlbum), more: albums.length === SEARCH_PAGE };
  }
  if (kind === "artists") {
    const response = await search3({ query: text, artistCount: SEARCH_PAGE, artistOffset: start });
    const artists = songsIn(response.searchResult3, "artist");
    return { artists: artists.map(toArtist), more: artists.length === SEARCH_PAGE };
  }
  if (kind === "playlists") {
    const response = await getPlaylists();
    const playlists = songsIn(response.playlists, "playlist");
    const lowered = text.toLowerCase();
    const matches = playlists.filter((playlist) => String(playlist.name || playlist.title || "").toLowerCase().includes(lowered));
    const page = matches.slice(start, start + SEARCH_PAGE).map((playlist) => toPlaylist(playlist));
    return { playlists: page, more: start + SEARCH_PAGE < matches.length };
  }
  throw fail("unsupported", t("This kind of search isn't supported"));
}

/** What a search being typed may be after: names from the server. */
export async function suggest({ query }) {
  requireAccount();
  const text = String(query || "").trim();
  if (!text) return [];
  const response = await search3({ query: text, songCount: 4, albumCount: 3, artistCount: 4 });
  const result = response.searchResult3 || {};
  const names = [];
  for (const artist of songsIn(result, "artist")) {
    if (artist.name) names.push(String(artist.name));
  }
  for (const album of songsIn(result, "album")) {
    if (album.name) names.push(String(album.name));
  }
  for (const song of songsIn(result, "song")) {
    if (song.title) names.push(String(song.title));
  }
  return [...new Set(names)].slice(0, 8);
}

/** An album's page. */
export async function album({ id }) {
  requireAccount();
  const response = await getAlbum({ id: String(id || "") });
  const found = response.album;
  if (!found) throw unavailableFail(t("This album isn't in the library"));
  const songs = songsIn(found, "song");
  return { album: toAlbum(found), tracks: songs.map(toTrack) };
}

/** An artist's page: their albums, and their most played songs if the server knows them. */
export async function artist({ id }) {
  requireAccount();
  const response = await getArtist({ id: String(id || "") });
  const found = response.artist;
  if (!found) throw unavailableFail(t("This artist isn't in the library"));
  const albums = songsIn(found, "album").map(toAlbum);
  let tracks = [];
  try {
    // Navidrome answers this only with Last.fm set up; without it the page has no songs.
    const top = await getTopSongs({ artist: String(found.name || ""), count: 20 });
    tracks = songsIn(top.topSongs, "song").map(toTrack);
  } catch {
    tracks = [];
  }
  return { artist: toArtist(found), tracks, albums };
}

/** The listener's liked songs, a page at a time. */
export async function liked({ offset = 0 }) {
  requireAccount();
  const snapshot = await starredSnapshot();
  const start = Math.max(0, Number(offset) || 0);
  const songs = snapshot.songs.slice(start, start + LIST_PAGE);
  return { tracks: songs.map(toTrack), more: start + LIST_PAGE < snapshot.songs.length };
}

/** The listener's saved albums, a page at a time. */
export async function savedAlbums({ offset = 0 }) {
  requireAccount();
  const start = Math.max(0, Number(offset) || 0);
  const response = await getAlbumList2({ type: "starred", size: LIST_PAGE, offset: start });
  const albums = songsIn(response.albumList2, "album");
  return { albums: albums.map(toAlbum), more: albums.length === LIST_PAGE };
}

/** Which of the songs shown are liked, for the hearts in a list. */
export async function isLiked({ ids }) {
  requireAccount();
  return likedAmong(Array.isArray(ids) ? ids : []);
}

/** Likes or unlikes a song. */
export async function like({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ id: String(id || "") });
  invalidateCaches();
  return undefined;
}

/** Saves or unsaves an album. */
export async function saveAlbum({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ albumId: String(id || "") });
  return undefined;
}

/** Follows or unfollows an artist. */
export async function followArtist({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ artistId: String(id || "") });
  return undefined;
}

/** Every playlist the listener can see: theirs and the ones they saved. */
export async function playlists() {
  requireAccount();
  const response = await getPlaylists();
  return songsIn(response.playlists, "playlist").map((playlist) => toPlaylist(playlist));
}

/** A playlist's page, with its songs. */
export async function playlist({ id }) {
  requireAccount();
  const response = await getPlaylist({ id: String(id || "") });
  const found = response.playlist;
  if (!found) throw unavailableFail(t("This playlist isn't on the server"));
  return toPlaylistPage(found);
}

/** Makes an empty playlist, and answers it. */
export async function createPlaylist({ name }) {
  const config = requireAccount();
  const title = String(name || "").trim();
  const response = await createPlaylistOnServer({ name: title });
  if (response.playlist) return toPlaylist(response.playlist, config.username);
  // Older servers answer nothing useful; find the playlist they just made.
  const listed = await getPlaylists();
  const found = songsIn(listed.playlists, "playlist")
    .filter((playlist) => String(playlist.name || playlist.title || "") === title)
    .pop();
  if (!found) throw new Error(t("The server made the playlist but didn't return it; reopen the playlists page"));
  return toPlaylist(found, config.username);
}

/** Renames a playlist. */
export async function renamePlaylist({ id, name }) {
  requireAccount();
  await updatePlaylist({ playlistId: String(id || ""), name: String(name || "") });
  return undefined;
}

/** Deletes a playlist. */
export async function deletePlaylist({ id }) {
  requireAccount();
  await deletePlaylistOnServer({ id: String(id || "") });
  return undefined;
}

/** Adds songs to the end of a playlist. */
export async function addToPlaylist({ id, trackIds }) {
  requireAccount();
  const ids = (Array.isArray(trackIds) ? trackIds : []).map(String);
  if (!ids.length) return undefined;
  await updatePlaylist({ playlistId: String(id || ""), songIdToAdd: ids });
  return undefined;
}

/** Takes songs out of a playlist, wherever in it they are. */
export async function removeFromPlaylist({ id, trackIds }) {
  requireAccount();
  const remove = new Set((Array.isArray(trackIds) ? trackIds : []).map(String));
  const playlistId = String(id || "");
  if (!remove.size) return undefined;
  // Indices are for a fresh read, and are removed from the end so the earlier
  // ones keep their places.
  const response = await getPlaylist({ id: playlistId });
  const entries = entriesOf(response.playlist);
  const indexes = [];
  entries.forEach((song, index) => {
    if (remove.has(String(song.id))) indexes.push(index);
  });
  if (!indexes.length) return undefined;
  indexes.sort((a, b) => b - a);
  await updatePlaylist({ playlistId, songIndexToRemove: indexes });
  return undefined;
}

/** Moves a song within a playlist, as createPlaylist on the playlist redoes its order. */
export async function movePlaylistTrack({ id, from, to }) {
  requireAccount();
  const playlistId = String(id || "");
  const response = await getPlaylist({ id: playlistId });
  if (!response.playlist) throw unavailableFail(t("This playlist isn't on the server"));
  const entries = entriesOf(response.playlist);
  const fromIndex = Number(from);
  const toIndex = Number(to);
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= entries.length ||
    toIndex >= entries.length
  ) {
    throw unavailableFail(t("That song position doesn't exist in this playlist"));
  }
  if (fromIndex === toIndex) return undefined;
  // Subsonic can only set a playlist's songs anew, all of them in one URL, so
  // a very long playlist would make a request too long for some proxies.
  if (entries.length > 400) {
    throw unavailableFail(t("This playlist is too long to reorder from MyGo Music; reorder it in Navidrome"));
  }
  const songIds = entries.map((song) => String(song.id));
  const [moved] = songIds.splice(fromIndex, 1);
  songIds.splice(toIndex, 0, moved);
  await createPlaylistOnServer({ playlistId, songIds });
  return undefined;
}

/** What played lately, newest first: the app's recent list. */
export function recent() {
  return recentTracks();
}

/** Tells the plugin a song started playing: remember it, and scrobble if asked. */
export async function played({ id }) {
  const config = readConfig();
  if (!config.server || !config.username || !config.password) return undefined;
  const trackId = String(id || "");
  if (!trackId) return undefined;
  let track = trackShape(trackId);
  if (!track) {
    try {
      const response = await getSong({ id: trackId });
      track = response.song ? toTrack(response.song) : null;
    } catch {
      track = null;
    }
  }
  if (track) rememberPlayed(track);
  if (scrobbleEnabled(config)) {
    try {
      // MyGo Music says a song plays when it starts, so this counts it at once.
      await scrobble({ id: trackId, time: Date.now(), submission: "true" });
    } catch {
      // A failed scrobble isn't worth interrupting the music.
    }
  }
  return undefined;
}
