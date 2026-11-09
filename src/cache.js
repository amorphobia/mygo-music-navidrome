// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Answers the plugin asks the server for again and again: which songs are
// starred (for the heart on each row), and a short list of what played lately.
//
// The starred cache belongs to one server and account. Any setting that
// changes where the plugin looks, or who it is, forgets it, as does a like.

import { configKey } from "./config.js";
import { getStarred2 } from "./subsonic.js";

const STARRED_TTL_MS = 30_000;
const RECENT_KEY = "recentTracks";
const RECENT_LIMIT = 50;

let starredCache = null; // { key, at, songs, ids }
let starredPending = null; // { key, promise } — the answer on its way
let generation = 0; // raised when what the cache holds stops being true

/** Forgets what a change of settings or a like makes stale. */
export function invalidateCaches() {
  starredCache = null;
  starredPending = null;
  generation += 1;
}

/** The starred songs, from the server or the last answer. */
export async function starredSnapshot() {
  const key = configKey();
  if (starredCache && starredCache.key === key && Date.now() - starredCache.at < STARRED_TTL_MS) {
    return starredCache;
  }
  // The app asks about the hearts of a page's songs in one go, and several
  // pages at once: one request answers them all.
  if (starredPending && starredPending.key === key) return starredPending.promise;
  const startedAt = generation;
  const promise = (async () => {
    const response = await getStarred2();
    const starred = response && response.starred2 ? response.starred2 : {};
    const songs = Array.isArray(starred.song) ? starred.song.slice() : [];
    const snapshot = {
      key,
      at: Date.now(),
      songs,
      ids: new Set(songs.map((song) => String(song.id))),
    };
    if (generation === startedAt) starredCache = snapshot;
    return snapshot;
  })();
  starredPending = { key, promise };
  try {
    return await promise;
  } finally {
    if (starredPending && starredPending.promise === promise) starredPending = null;
  }
}

/** Which of these songs the listener likes. */
export async function likedAmong(ids) {
  const snapshot = await starredSnapshot();
  const liked = {};
  for (const id of ids || []) liked[String(id)] = snapshot.ids.has(String(id));
  return liked;
}

/** The songs played lately, newest first. */
export function recentTracks() {
  const stored = host.storage.get(RECENT_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((track) => track && typeof track === "object").map((track) => ({ ...track }));
}

/** Remembers a song as played, keeping the newest few. */
export function rememberPlayed(track) {
  if (!track || !track.id) return;
  const current = recentTracks().filter((other) => String(other.id) !== String(track.id));
  current.unshift(track);
  host.storage.set(RECENT_KEY, current.slice(0, RECENT_LIMIT));
}

/** Forgets the songs played lately, such as when the account changes. */
export function forgetRecent() {
  host.storage.remove(RECENT_KEY);
}
