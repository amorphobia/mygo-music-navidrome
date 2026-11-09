// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// The Subsonic methods the plugin calls, each one call to request().
//
// Navidrome speaks the OpenSubsonic dialect of Subsonic 1.16.1. The response
// keys differ a little between servers and versions, so callers read the ones
// they need, and entriesOf() in mappers.js handles the playlist entry names.

import { request } from "./http.js";

export const ping = () => request("ping");

export function search3({ query, songCount, songOffset, albumCount, albumOffset, artistCount, artistOffset }) {
  return request("search3", { query, songCount, songOffset, albumCount, albumOffset, artistCount, artistOffset });
}

export const getAlbumList2 = ({ type, size, offset, fromYear, toYear, genre }) =>
  request("getAlbumList2", { type, size, offset, fromYear, toYear, genre });

export const getAlbum = ({ id }) => request("getAlbum", { id });
export const getArtist = ({ id }) => request("getArtist", { id });
export const getArtists = () => request("getArtists");
export const getTopSongs = ({ artist, count }) => request("getTopSongs", { artist, count });
export const getStarred2 = () => request("getStarred2");
export const getRandomSongs = ({ size, genre, fromYear, toYear }) => request("getRandomSongs", { size, genre, fromYear, toYear });
export const getSong = ({ id }) => request("getSong", { id });

export const getPlaylists = () => request("getPlaylists");
export const getPlaylist = ({ id }) => request("getPlaylist", { id });

export const createPlaylist = ({ name, playlistId, songIds }) =>
  request("createPlaylist", { name, playlistId, songId: songIds || undefined });

export function updatePlaylist({ playlistId, name, comment, songIdToAdd, songIndexToRemove }) {
  return request("updatePlaylist", {
    playlistId,
    name,
    comment,
    songIdToAdd,
    songIndexToRemove,
  });
}

export const deletePlaylist = ({ id }) => request("deletePlaylist", { id });

export const star = ({ id, albumId, artistId }) => request("star", { id, albumId, artistId });
export const unstar = ({ id, albumId, artistId }) => request("unstar", { id, albumId, artistId });

export const scrobble = ({ id, time, submission }) =>
  request("scrobble", { id, time, submission });

export const getLyricsBySongId = ({ id }) => request("getLyricsBySongId", { id });
export const getLyrics = ({ artist, title }) => request("getLyrics", { artist, title });
