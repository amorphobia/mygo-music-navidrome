// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
//
// Navidrome: a Navidrome (Subsonic / OpenSubsonic) source for MyGo Music, with
// custom HTTP headers for the API, the covers and the audio, so a server behind
// Cloudflare Access (Zero Trust service tokens) or another header-based reverse
// proxy works as it does without one.
//
// The exported functions are MyGo Music's plugin API. Each takes one object of
// parameters and returns a value or a promise; throwing an error with a `code`
// of signIn, setup, unavailable or unsupported tells the app what to do.

import { forgetMediaAuth, readConfig, requireAccount } from "./config.js";
import { forgetRecent, invalidateCaches } from "./cache.js";
import { forgetTrackShapes } from "./mappers.js";
import { ping } from "./subsonic.js";

export {
  addToPlaylist,
  album,
  artist,
  createPlaylist,
  deletePlaylist,
  followArtist,
  isLiked,
  like,
  liked,
  movePlaylistTrack,
  played,
  playlist,
  playlists,
  recent,
  removeFromPlaylist,
  renamePlaylist,
  saveAlbum,
  savedAlbums,
  search,
  suggest,
} from "./library.js";
export { browse, home } from "./browse.js";
export { stream } from "./playback.js";
export { lyrics } from "./lyrics.js";

/** Who is signed in: the server and account in the settings, or null when they're not filled in. */
export function account() {
  const config = readConfig();
  if (!config.server || !config.username || !config.password) return null;
  // Navidrome has no session to check: a filled-in account is a signed-in one.
  // A wrong password shows when the first request is refused, which opens the
  // settings with what the server said.
  return { id: config.username, name: config.username };
}

/** Checks the main address and the account, answering the account when it works. */
export async function signIn() {
  const config = requireAccount();
  await ping();
  return { id: config.username, name: config.username };
}

/** Navidrome has no session to end here; the plugin forgets what it remembered. */
export function signOut() {
  invalidateCaches();
  forgetMediaAuth();
  forgetTrackShapes();
  forgetRecent();
  return undefined;
}

/** The app saved a setting: anything remembered about the old one goes. */
export function setSetting({ key }) {
  invalidateCaches();
  forgetMediaAuth();
  forgetTrackShapes();
  if (key === "server" || key === "username" || key === "password") forgetRecent();
  return undefined;
}
