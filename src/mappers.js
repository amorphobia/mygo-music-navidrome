// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
//
// Subsonic JSON to what MyGo Music shows: tracks, albums, artists, playlists.
//
// Subsonic counts a track in seconds and MyGo Music in milliseconds, and some
// servers give one artist string while OpenSubsonic gives an array; both are
// handled here. Cover URLs keep MyGo's {size} placeholder so the app fetches
// each picture at the size it shows it.
//
// Cover URLs and stream URLs carry one Subsonic token for the whole session
// (see mediaApiUrl in config.js): the app caches pictures and audio by URL, so
// a token minted for every page would make every cover a new, uncached one.

import { mediaApiUrl, readConfig } from "./config.js";

/** The URL of a cover, or "" when there is none. */
export function coverUrl(id) {
  if (!id) return "";
  try {
    // {size} is left for the app to fill in with the pixels it shows.
    return mediaApiUrl("getCoverArt", { id: String(id), size: "{size}" });
  } catch {
    return "";
  }
}

/** The artists an item credits: OpenSubsonic's array, or the flat fields. */
export function artistsOf(source, fallbackName, fallbackId) {
  const listed = source && Array.isArray(source.artists) ? source.artists : [];
  const artists = [];
  for (const artist of listed) {
    const name = String((artist && artist.name) || "");
    if (!name) continue;
    artists.push({ id: String((artist && artist.id) || ""), name });
  }
  if (!artists.length && fallbackName) {
    artists.push({ id: String(fallbackId || ""), name: String(fallbackName) });
  }
  return artists;
}

/** An artist, as MyGo Music shows one. */
export function toArtist(artist) {
  const id = String((artist && artist.id) || "");
  const image = (artist && artist.coverArt) || (id ? `ar-${id}` : "");
  return {
    id,
    name: String((artist && artist.name) || (artist && artist.title) || ""),
    imageUrl: coverUrl(image),
    following: Boolean(artist && artist.starred),
  };
}

/** An album, as MyGo Music shows one. */
export function toAlbum(album) {
  const id = String((album && album.id) || "");
  const image = (album && album.coverArt) || "";
  const albumArtists = artistsOf(album, album && album.artist, album && album.artistId);
  return {
    id,
    name: String((album && album.name) || (album && album.title) || ""),
    imageUrl: coverUrl(image),
    artists: albumArtists,
    released: album && album.year ? String(album.year) : "",
    saved: Boolean(album && album.starred),
  };
}

// The app tells the plugin a song started with only its ID. The shapes made
// while building pages are kept for a while, so that usually costs no request.
const KNOWN_LIMIT = 400;
const knownTracks = new Map();

/** The track shape last mapped for this ID, or null. */
export function trackShape(id) {
  const track = knownTracks.get(String(id));
  return track ? { ...track, artists: (track.artists || []).map((artist) => ({ ...artist })) } : null;
}

/** Forgets the remembered shapes, such as when the account changes. */
export function forgetTrackShapes() {
  knownTracks.clear();
}

function rememberShape(track) {
  knownTracks.delete(track.id);
  knownTracks.set(track.id, track);
  while (knownTracks.size > KNOWN_LIMIT) {
    const oldest = knownTracks.keys().next().value;
    if (oldest === undefined) break;
    knownTracks.delete(oldest);
  }
}

/** A track (a song) as MyGo Music plays one. */
export function toTrack(song) {
  const artists = artistsOf(song, song && song.artist, song && song.artistId);
  const cover = (song && song.coverArt) || "";
  const duration = Number(song && song.duration);
  const track = {
    id: String((song && song.id) || ""),
    name: String((song && song.title) || (song && song.name) || ""),
    artists,
    album: {
      id: String((song && song.albumId) || ""),
      name: String((song && song.album) || ""),
      imageUrl: coverUrl(cover),
      artists,
      released: song && song.year ? String(song.year) : "",
      // A song being starred doesn't mean its album is saved; leave it unset.
    },
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0,
    unavailable: Boolean(song && song.isVideo),
  };
  rememberShape(track);
  return track;
}

/** A playlist, as MyGo Music lists one. */
export function toPlaylist(playlist, username = readConfig().username) {
  const owner = String((playlist && playlist.owner) || "");
  const entries = entriesOf(playlist);
  const count = Number(playlist && playlist.songCount);
  const list = {
    id: String((playlist && playlist.id) || ""),
    name: String((playlist && playlist.name) || (playlist && playlist.title) || ""),
    imageUrl: coverUrl(playlist && playlist.coverArt),
    description: String((playlist && playlist.comment) || ""),
    owner,
    trackCount: Number.isFinite(count) ? count : entries.length,
  };
  if (owner && owner === username) list.mine = true;
  else if (owner) list.saved = true;
  return list;
}

/** A playlist with its songs, as MyGo Music shows the playlist's page. */
export function toPlaylistPage(playlist, username = readConfig().username) {
  const entries = entriesOf(playlist);
  const page = toPlaylist(playlist, username);
  page.trackCount = Number.isFinite(Number(playlist && playlist.songCount)) ? Number(playlist.songCount) : entries.length;
  page.tracks = entries.map(toTrack);
  return page;
}

/** The songs of a playlist response, whatever the server calls them. */
export function entriesOf(playlist) {
  if (!playlist) return [];
  for (const key of ["entry", "child", "song"]) {
    if (Array.isArray(playlist[key])) return playlist[key];
  }
  return [];
}
