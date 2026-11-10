// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
//
// The Songs page's ordering. Navidrome's Subsonic API can only return the
// whole library in its natural order, but Navidrome's own REST API can sort it
// (`/api/song?_sort=title&_order=ASC`). This module detects Navidrome and uses
// that API when it is there; otherwise the Songs page falls back to Subsonic.
//
// The detection is automatic and per server: probe Navidrome's native route,
// and only if it answers the way Navidrome does (401 without a JWT) ask for a
// token with the listener's username and password. Nothing is stored on disk;
// a session keeps the token in memory and re-signs in when it expires.

import { baseUrl, configKey, readConfig, requestHeaders } from "./config.js";
import { coverUrl } from "./mappers.js";

const PROBE_TIMEOUT_MS = 4_000;
const LOGIN_TIMEOUT_MS = 8_000;
const SONGS_TIMEOUT_MS = 15_000;

// { key, token } while signed in, or { key, token: null } when the server
// turned out not to expose Navidrome's native API. It's decided once per
// sign-in, so nothing is probed again until the settings change.
let session = null;
let pending = null;

/** Forgets the native session, such as when the settings change. */
export function forgetNativeSession() {
  session = null;
  pending = null;
}

/** Starts deciding, before anything needs it, whether the server is Navidrome. */
export function warmNativeSession(config = readConfig()) {
  if (!config.server || !config.username || !config.password) return;
  nativeSession(config).catch(() => {});
}

function withTimeout(ms) {
  if (typeof AbortController !== "function") return { signal: undefined, clear: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // The request is finished already.
    }
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function requestWithTimeout(url, options, ms) {
  const { signal, clear } = withTimeout(ms);
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clear();
  }
}

/** Whether the server answers Navidrome's native API route the way Navidrome does. */
async function looksLikeNavidrome(config) {
  const url = new URL(`${baseUrl(config)}/api/song`);
  url.searchParams.set("_start", "0");
  url.searchParams.set("_end", "1");
  const response = await requestWithTimeout(url.toString(), { headers: requestHeaders(config) }, PROBE_TIMEOUT_MS);
  return response.status === 401;
}

/** Signs in to Navidrome's native API, answering its JWT or null. */
async function nativeLogin(config) {
  const response = await requestWithTimeout(
    `${baseUrl(config)}/auth/login`,
    {
      method: "POST",
      headers: { ...requestHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ username: config.username, password: config.password }),
    },
    LOGIN_TIMEOUT_MS,
  );
  if (response.status !== 200) return null;
  try {
    const payload = await response.json();
    return payload && typeof payload.token === "string" && payload.token ? payload.token : null;
  } catch {
    return null;
  }
}

/** The native API token, or null when the server isn't Navidrome. */
export async function nativeSession(config = readConfig()) {
  const key = configKey(config);
  if (session && session.key === key) return session.token;
  if (pending && pending.key === key) return pending.promise;
  const promise = (async () => {
    let token = null;
    try {
      if (await looksLikeNavidrome(config)) token = await nativeLogin(config);
    } catch {
      token = null;
    }
    session = { key, token };
    return token;
  })();
  pending = { key, promise };
  try {
    return await promise;
  } finally {
    if (pending && pending.promise === promise) pending = null;
  }
}

async function nativeSongsRequest(config, token, offset, size) {
  const url = new URL(`${baseUrl(config)}/api/song`);
  url.searchParams.set("_sort", "title");
  url.searchParams.set("_order", "ASC");
  url.searchParams.set("_start", String(offset));
  url.searchParams.set("_end", String(offset + size));
  return requestWithTimeout(
    url.toString(),
    { headers: { ...requestHeaders(config), "X-ND-Authorization": `Bearer ${token}` } },
    SONGS_TIMEOUT_MS,
  );
}

/**
 * One page of the whole library, in title order, from Navidrome's own API.
 * Answers null when the server isn't Navidrome or the API fails, for the
 * caller to fall back to Subsonic.
 */
export async function nativeSongsPage({ offset = 0, size = 100 } = {}, config = readConfig()) {
  const start = Math.max(0, Number(offset) || 0);
  let token = await nativeSession(config);
  if (!token) return null;

  let response;
  try {
    response = await nativeSongsRequest(config, token, start, size);
    if (response.status === 401) {
      // The token expired: sign in again once, then retry the page.
      forgetNativeSession();
      token = await nativeSession(config);
      if (!token) return null;
      response = await nativeSongsRequest(config, token, start, size);
    }
  } catch {
    return null;
  }
  if (response.status !== 200) return null;

  let songs;
  try {
    songs = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(songs)) return null;

  const header = (name) => (response.headers && typeof response.headers.get === "function" ? response.headers.get(name) : null);
  const refreshed = header("x-nd-authorization");
  if (typeof refreshed === "string" && refreshed) {
    const key = configKey(config);
    session = { key, token: refreshed.replace(/^Bearer\s+/i, "") };
  }
  const totalHeader = header("x-total-count");
  const total = totalHeader === null || totalHeader === "" ? null : Number(totalHeader);
  return { songs, total: Number.isFinite(total) ? total : null };
}

/** The structured artists of a native song, for a role, or [] when it has none. */
function nativeArtists(song, role) {
  const participants = song && song.participants && Array.isArray(song.participants[role]) ? song.participants[role] : [];
  return participants
    .map((participant) => ({
      id: String((participant && participant.id) || ""),
      name: String((participant && participant.name) || ""),
    }))
    .filter((artist) => artist.name);
}

/** A song from Navidrome's native API, as MyGo Music plays one. */
export function nativeTrack(song) {
  const artists = nativeArtists(song, "artist");
  const trackArtists = artists.length
    ? artists
    : song.artist
      ? [{ id: String(song.artistId || ""), name: String(song.artist) }]
      : [];
  const albumArtists = nativeArtists(song, "albumartist");
  const albumId = String((song && song.albumId) || "");
  // Navidrome's Subsonic cover IDs are "al-" plus the raw album ID; be tolerant
  // of an ID that already carries the prefix.
  const coverId = albumId ? (/^al-/.test(albumId) ? albumId : `al-${albumId}`) : "";
  const album = {
    id: albumId,
    name: String((song && song.album) || ""),
    imageUrl: coverUrl(coverId),
    artists: albumArtists.length
      ? albumArtists
      : song.albumArtist
        ? [{ id: String(song.albumArtistId || ""), name: String(song.albumArtist) }]
        : trackArtists,
    released: song && song.year ? String(song.year) : "",
  };
  const duration = Number(song && song.duration);
  return {
    id: String((song && song.id) || ""),
    name: String((song && song.title) || ""),
    artists: trackArtists,
    album,
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1000)) : 0,
    unavailable: Boolean(song && song.missing),
  };
}
