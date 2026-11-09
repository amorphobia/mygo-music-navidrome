// Navidrome 0.1.0 — generated from src/ by npm run build. Do not edit.
// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// A Navidrome / Subsonic source for MyGo Music with custom HTTP headers.


// src/errors.js
var t = (text) => host && typeof host.t === "function" ? host.t(text) : text;
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
var setupFail = (message) => fail("setup", message);
var unavailableFail = (message) => fail("unavailable", message);
var setupMessages = {
  server: () => t("Fill in the server address in the plugin settings"),
  credentials: () => t("Fill in the username and password in the plugin settings"),
  headers: () => t('Extra headers must be a JSON object, such as {"X-Api-Key": "value"}')
};
var cloudflareMessage = () => t("Access was denied (HTTP 403). If the server is behind Cloudflare Access, fill in the Cloudflare Access Client ID and Secret in the plugin settings, and check that the Access policy's action is Service Auth and that the token is allowed for this server.");
var htmlMessage = () => t("The server answered with a web page instead of Subsonic data. If it is behind Cloudflare Access, fill in the Cloudflare Access Client ID and Secret in the plugin settings; otherwise check the server address and reverse-proxy path.");
var credentialsMessage = () => t("The server rejected the username or password. Check them in the plugin settings.");
var networkMessage = () => t("Could not reach the server. Check the address, the network and the HTTPS certificate.");
var notSubsonicMessage = () => t("This address did not return Subsonic data. Check the server address and any reverse-proxy path.");
var serverError = (detail) => t("The server reported an error") + (detail ? `: ${detail}` : "");

// src/config.js
var CLIENT = "mygo-music-navidrome";
var API_VERSION = "1.16.1";
var setting = (key) => {
  const value = host.setting(key);
  return typeof value === "string" ? value : value == null ? "" : String(value);
};
function readConfig() {
  return {
    server: setting("server").trim(),
    username: setting("username").trim(),
    // A password may start or end with a space, so it isn't trimmed.
    password: setting("password"),
    cfAccessClientId: setting("cfAccessClientId").trim(),
    cfAccessClientSecret: setting("cfAccessClientSecret").trim(),
    authorization: setting("authorization").trim(),
    cookie: setting("cookie").trim(),
    customHeaders: setting("customHeaders").trim(),
    scrobble: setting("scrobble").trim()
  };
}
function scrobbleEnabled(config = readConfig()) {
  return /^(1|true|yes|on)$/i.test(config.scrobble);
}
function baseUrl(config = readConfig()) {
  let server = config.server;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(server)) {
    server = `https://${server}`;
  }
  server = server.replace(/\/+$/, "");
  return server;
}
function requireServer() {
  const config = readConfig();
  if (!config.server) throw setupFail(setupMessages.server());
  return config;
}
function requireAccount() {
  const config = requireServer();
  if (!config.username || !config.password) throw setupFail(setupMessages.credentials());
  return config;
}
function apiUrl(method, params = {}, config = readConfig(), auth = authParams(config)) {
  const url = new URL(`${baseUrl(config)}/rest/${method}`);
  addParams(url, auth);
  addParams(url, { v: API_VERSION, c: CLIENT, f: "json" });
  addParams(url, params);
  return url.toString();
}
function addParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== void 0 && item !== null && item !== "") url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}
function newSalt() {
  const words = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${words}${Math.random().toString(36).slice(2)}`.slice(0, 20).padEnd(8, "0");
}
function authParams(config = readConfig(), salt = newSalt()) {
  return {
    u: config.username,
    t: host.crypto.md5(config.password + salt),
    s: salt
  };
}
var mediaAuth = null;
function mediaAuthParams(config = readConfig()) {
  const key = configKey(config);
  if (!mediaAuth || mediaAuth.key !== key) {
    mediaAuth = { key, auth: authParams(config) };
  }
  return mediaAuth.auth;
}
function forgetMediaAuth() {
  mediaAuth = null;
}
function mediaApiUrl(method, params = {}, config = readConfig()) {
  return apiUrl(method, params, config, mediaAuthParams(config));
}
function requestHeaders(config = readConfig(), { json = true } = {}) {
  const headers = {};
  if (json) headers.Accept = "application/json";
  if (config.cfAccessClientId) headers["CF-Access-Client-Id"] = config.cfAccessClientId;
  if (config.cfAccessClientSecret) headers["CF-Access-Client-Secret"] = config.cfAccessClientSecret;
  if (config.authorization) headers.Authorization = config.authorization;
  if (config.cookie) headers.Cookie = config.cookie;
  Object.assign(headers, extraHeaders(config));
  return headers;
}
var headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function extraHeaders(config = readConfig()) {
  const text = config.customHeaders;
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw setupFail(setupMessages.headers());
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw setupFail(setupMessages.headers());
  }
  const headers = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!headerName.test(name)) continue;
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "content-length" || lower === "connection") continue;
    if (value === void 0 || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const text2 = String(value);
    if (/[\r\n]/.test(text2)) continue;
    headers[name] = text2;
  }
  return headers;
}
function configKey(config = readConfig()) {
  return [
    baseUrl(config),
    config.username,
    host.crypto.md5(config.password),
    config.cfAccessClientId,
    config.cfAccessClientSecret,
    config.authorization,
    config.cookie,
    config.customHeaders
  ].join("\0");
}

// src/http.js
var TIMEOUT_MS = 25e3;
var AUTH_CODES = /* @__PURE__ */ new Set([40, 41, 42, 43, 44, 50]);
var setupFail2 = (message) => fail("setup", message);
var failure = (error) => {
  const code = Number(error && error.code);
  return Number.isFinite(code) ? code : void 0;
};
function serverFailure(error, method) {
  const code = failure(error);
  const message = error && typeof error.message === "string" ? error.message : "";
  if (code !== void 0 && AUTH_CODES.has(code)) {
    forgetMediaAuth();
    return setupFail2(message || credentialsMessage());
  }
  if (code === 70 && (method === "stream" || method === "getSong" || method === "download")) {
    return fail("unavailable", message || t("This track isn't available on the server"));
  }
  const detail = message || (code !== void 0 ? String(code) : "");
  return new Error(serverError(detail));
}
function parseEnvelope(text) {
  if (!text || typeof text !== "string") return null;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = json && json["subsonic-response"];
  if (!envelope || typeof envelope !== "object") return null;
  return envelope;
}
var looksLikeHtml = (contentType, text) => {
  if (contentType.includes("text/html")) return true;
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<");
};
function checkResponse(response, method) {
  const status = Number(response.status) || 0;
  const contentType = String(response.headers && typeof response.headers.get === "function" ? response.headers.get("content-type") || "" : "").toLowerCase();
  return Promise.resolve().then(() => response.text()).then((text) => {
    const envelope = parseEnvelope(text);
    const error = envelope && envelope.error;
    if (!response.ok) {
      const code = failure(error);
      if (status === 401 || code !== void 0 && AUTH_CODES.has(code)) {
        forgetMediaAuth();
        throw setupFail2(error && error.message || credentialsMessage());
      }
      if (status === 403) {
        forgetMediaAuth();
        throw setupFail2(cloudflareMessage());
      }
      if (looksLikeHtml(contentType, text)) throw setupFail2(htmlMessage());
      throw new Error(serverError(`HTTP ${status}`));
    }
    if (looksLikeHtml(contentType, text)) throw setupFail2(htmlMessage());
    if (!envelope) throw new Error(notSubsonicMessage());
    if (envelope.status === "failed") throw serverFailure(envelope.error, method);
    return envelope;
  });
}
async function request(method, params = {}) {
  const config = readConfig();
  const url = apiUrl(method, params, config);
  const headers = requestHeaders(config);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  if (controller) {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
      }
    }, TIMEOUT_MS);
  }
  let response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: controller ? controller.signal : void 0 });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(t("The server took too long to answer"));
    }
    throw new Error(networkMessage());
  } finally {
    if (timer) clearTimeout(timer);
  }
  return checkResponse(response, method);
}

// src/subsonic.js
var ping = () => request("ping");
function search3({ query, songCount, songOffset, albumCount, albumOffset, artistCount, artistOffset }) {
  return request("search3", { query, songCount, songOffset, albumCount, albumOffset, artistCount, artistOffset });
}
var getAlbumList2 = ({ type, size, offset, fromYear, toYear, genre }) => request("getAlbumList2", { type, size, offset, fromYear, toYear, genre });
var getAlbum = ({ id }) => request("getAlbum", { id });
var getArtist = ({ id }) => request("getArtist", { id });
var getArtists = () => request("getArtists");
var getTopSongs = ({ artist: artist2, count }) => request("getTopSongs", { artist: artist2, count });
var getStarred2 = () => request("getStarred2");
var getRandomSongs = ({ size, genre, fromYear, toYear }) => request("getRandomSongs", { size, genre, fromYear, toYear });
var getSong = ({ id }) => request("getSong", { id });
var getPlaylists = () => request("getPlaylists");
var getPlaylist = ({ id }) => request("getPlaylist", { id });
var createPlaylist = ({ name, playlistId, songIds }) => request("createPlaylist", { name, playlistId, songId: songIds || void 0 });
function updatePlaylist({ playlistId, name, comment, songIdToAdd, songIndexToRemove }) {
  return request("updatePlaylist", {
    playlistId,
    name,
    comment,
    songIdToAdd,
    songIndexToRemove
  });
}
var deletePlaylist = ({ id }) => request("deletePlaylist", { id });
var star = ({ id, albumId, artistId }) => request("star", { id, albumId, artistId });
var unstar = ({ id, albumId, artistId }) => request("unstar", { id, albumId, artistId });
var scrobble = ({ id, time, submission }) => request("scrobble", { id, time, submission });
var getLyricsBySongId = ({ id }) => request("getLyricsBySongId", { id });
var getLyrics = ({ artist: artist2, title }) => request("getLyrics", { artist: artist2, title });

// src/cache.js
var STARRED_TTL_MS = 3e4;
var RECENT_KEY = "recentTracks";
var RECENT_LIMIT = 50;
var starredCache = null;
var starredPending = null;
var generation = 0;
function invalidateCaches() {
  starredCache = null;
  starredPending = null;
  generation += 1;
}
async function starredSnapshot() {
  const key = configKey();
  if (starredCache && starredCache.key === key && Date.now() - starredCache.at < STARRED_TTL_MS) {
    return starredCache;
  }
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
      ids: new Set(songs.map((song) => String(song.id)))
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
async function likedAmong(ids) {
  const snapshot = await starredSnapshot();
  const liked2 = {};
  for (const id of ids || []) liked2[String(id)] = snapshot.ids.has(String(id));
  return liked2;
}
function recentTracks() {
  const stored = host.storage.get(RECENT_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((track) => track && typeof track === "object").map((track) => ({ ...track }));
}
function rememberPlayed(track) {
  if (!track || !track.id) return;
  const current = recentTracks().filter((other) => String(other.id) !== String(track.id));
  current.unshift(track);
  host.storage.set(RECENT_KEY, current.slice(0, RECENT_LIMIT));
}
function forgetRecent() {
  host.storage.remove(RECENT_KEY);
}

// src/mappers.js
function coverUrl(id) {
  if (!id) return "";
  try {
    return mediaApiUrl("getCoverArt", { id: String(id), size: "{size}" });
  } catch {
    return "";
  }
}
function artistsOf(source, fallbackName, fallbackId) {
  const listed = source && Array.isArray(source.artists) ? source.artists : [];
  const artists = [];
  for (const artist2 of listed) {
    const name = String(artist2 && artist2.name || "");
    if (!name) continue;
    artists.push({ id: String(artist2 && artist2.id || ""), name });
  }
  if (!artists.length && fallbackName) {
    artists.push({ id: String(fallbackId || ""), name: String(fallbackName) });
  }
  return artists;
}
function toArtist(artist2) {
  const id = String(artist2 && artist2.id || "");
  const image = artist2 && artist2.coverArt || (id ? `ar-${id}` : "");
  return {
    id,
    name: String(artist2 && artist2.name || artist2 && artist2.title || ""),
    imageUrl: coverUrl(image),
    following: Boolean(artist2 && artist2.starred)
  };
}
function toAlbum(album2) {
  const id = String(album2 && album2.id || "");
  const image = album2 && album2.coverArt || "";
  const albumArtists = artistsOf(album2, album2 && album2.artist, album2 && album2.artistId);
  return {
    id,
    name: String(album2 && album2.name || album2 && album2.title || ""),
    imageUrl: coverUrl(image),
    artists: albumArtists,
    released: album2 && album2.year ? String(album2.year) : "",
    saved: Boolean(album2 && album2.starred)
  };
}
var KNOWN_LIMIT = 400;
var knownTracks = /* @__PURE__ */ new Map();
function trackShape(id) {
  const track = knownTracks.get(String(id));
  return track ? { ...track, artists: (track.artists || []).map((artist2) => ({ ...artist2 })) } : null;
}
function forgetTrackShapes() {
  knownTracks.clear();
}
function rememberShape(track) {
  knownTracks.delete(track.id);
  knownTracks.set(track.id, track);
  while (knownTracks.size > KNOWN_LIMIT) {
    const oldest = knownTracks.keys().next().value;
    if (oldest === void 0) break;
    knownTracks.delete(oldest);
  }
}
function toTrack(song) {
  const artists = artistsOf(song, song && song.artist, song && song.artistId);
  const cover = song && song.coverArt || "";
  const duration = Number(song && song.duration);
  const track = {
    id: String(song && song.id || ""),
    name: String(song && song.title || song && song.name || ""),
    artists,
    album: {
      id: String(song && song.albumId || ""),
      name: String(song && song.album || ""),
      imageUrl: coverUrl(cover),
      artists,
      released: song && song.year ? String(song.year) : ""
      // A song being starred doesn't mean its album is saved; leave it unset.
    },
    duration: Number.isFinite(duration) ? Math.max(0, Math.round(duration * 1e3)) : 0,
    unavailable: Boolean(song && song.isVideo)
  };
  rememberShape(track);
  return track;
}
function toPlaylist(playlist2, username = readConfig().username) {
  const owner = String(playlist2 && playlist2.owner || "");
  const entries = entriesOf(playlist2);
  const count = Number(playlist2 && playlist2.songCount);
  const list = {
    id: String(playlist2 && playlist2.id || ""),
    name: String(playlist2 && playlist2.name || playlist2 && playlist2.title || ""),
    imageUrl: coverUrl(playlist2 && playlist2.coverArt),
    description: String(playlist2 && playlist2.comment || ""),
    owner,
    trackCount: Number.isFinite(count) ? count : entries.length
  };
  if (owner && owner === username) list.mine = true;
  else if (owner) list.saved = true;
  return list;
}
function toPlaylistPage(playlist2, username = readConfig().username) {
  const entries = entriesOf(playlist2);
  const page = toPlaylist(playlist2, username);
  page.trackCount = Number.isFinite(Number(playlist2 && playlist2.songCount)) ? Number(playlist2.songCount) : entries.length;
  page.tracks = entries.map(toTrack);
  return page;
}
function entriesOf(playlist2) {
  if (!playlist2) return [];
  for (const key of ["entry", "child", "song"]) {
    if (Array.isArray(playlist2[key])) return playlist2[key];
  }
  return [];
}

// src/library.js
var SEARCH_PAGE = 30;
var LIST_PAGE = 50;
var songsIn = (response, key) => {
  const list = response && response[key];
  return Array.isArray(list) ? list : [];
};
async function search({ query, kind, offset = 0 }) {
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
    const playlists2 = songsIn(response.playlists, "playlist");
    const lowered = text.toLowerCase();
    const matches = playlists2.filter((playlist2) => String(playlist2.name || playlist2.title || "").toLowerCase().includes(lowered));
    const page = matches.slice(start, start + SEARCH_PAGE).map((playlist2) => toPlaylist(playlist2));
    return { playlists: page, more: start + SEARCH_PAGE < matches.length };
  }
  throw fail("unsupported", t("This kind of search isn't supported"));
}
async function suggest({ query }) {
  requireAccount();
  const text = String(query || "").trim();
  if (!text) return [];
  const response = await search3({ query: text, songCount: 4, albumCount: 3, artistCount: 4 });
  const result = response.searchResult3 || {};
  const names = [];
  for (const artist2 of songsIn(result, "artist")) {
    if (artist2.name) names.push(String(artist2.name));
  }
  for (const album2 of songsIn(result, "album")) {
    if (album2.name) names.push(String(album2.name));
  }
  for (const song of songsIn(result, "song")) {
    if (song.title) names.push(String(song.title));
  }
  return [...new Set(names)].slice(0, 8);
}
async function album({ id }) {
  requireAccount();
  const response = await getAlbum({ id: String(id || "") });
  const found = response.album;
  if (!found) throw unavailableFail(t("This album isn't in the library"));
  const songs = songsIn(found, "song");
  return { album: toAlbum(found), tracks: songs.map(toTrack) };
}
async function artist({ id }) {
  requireAccount();
  const response = await getArtist({ id: String(id || "") });
  const found = response.artist;
  if (!found) throw unavailableFail(t("This artist isn't in the library"));
  const albums = songsIn(found, "album").map(toAlbum);
  let tracks = [];
  try {
    const top = await getTopSongs({ artist: String(found.name || ""), count: 20 });
    tracks = songsIn(top.topSongs, "song").map(toTrack);
  } catch {
    tracks = [];
  }
  return { artist: toArtist(found), tracks, albums };
}
async function liked({ offset = 0 }) {
  requireAccount();
  const snapshot = await starredSnapshot();
  const start = Math.max(0, Number(offset) || 0);
  const songs = snapshot.songs.slice(start, start + LIST_PAGE);
  return { tracks: songs.map(toTrack), more: start + LIST_PAGE < snapshot.songs.length };
}
async function savedAlbums({ offset = 0 }) {
  requireAccount();
  const start = Math.max(0, Number(offset) || 0);
  const response = await getAlbumList2({ type: "starred", size: LIST_PAGE, offset: start });
  const albums = songsIn(response.albumList2, "album");
  return { albums: albums.map(toAlbum), more: albums.length === LIST_PAGE };
}
async function isLiked({ ids }) {
  requireAccount();
  return likedAmong(Array.isArray(ids) ? ids : []);
}
async function like({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ id: String(id || "") });
  invalidateCaches();
  return void 0;
}
async function saveAlbum({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ albumId: String(id || "") });
  return void 0;
}
async function followArtist({ id, on }) {
  requireAccount();
  await (on ? star : unstar)({ artistId: String(id || "") });
  return void 0;
}
async function playlists() {
  requireAccount();
  const response = await getPlaylists();
  return songsIn(response.playlists, "playlist").map((playlist2) => toPlaylist(playlist2));
}
async function playlist({ id }) {
  requireAccount();
  const response = await getPlaylist({ id: String(id || "") });
  const found = response.playlist;
  if (!found) throw unavailableFail(t("This playlist isn't on the server"));
  return toPlaylistPage(found);
}
async function createPlaylist2({ name }) {
  const config = requireAccount();
  const title = String(name || "").trim();
  const response = await createPlaylist({ name: title });
  if (response.playlist) return toPlaylist(response.playlist, config.username);
  const listed = await getPlaylists();
  const found = songsIn(listed.playlists, "playlist").filter((playlist2) => String(playlist2.name || playlist2.title || "") === title).pop();
  if (!found) throw new Error(t("The server made the playlist but didn't return it; reopen the playlists page"));
  return toPlaylist(found, config.username);
}
async function renamePlaylist({ id, name }) {
  requireAccount();
  await updatePlaylist({ playlistId: String(id || ""), name: String(name || "") });
  return void 0;
}
async function deletePlaylist2({ id }) {
  requireAccount();
  await deletePlaylist({ id: String(id || "") });
  return void 0;
}
async function addToPlaylist({ id, trackIds }) {
  requireAccount();
  const ids = (Array.isArray(trackIds) ? trackIds : []).map(String);
  if (!ids.length) return void 0;
  await updatePlaylist({ playlistId: String(id || ""), songIdToAdd: ids });
  return void 0;
}
async function removeFromPlaylist({ id, trackIds }) {
  requireAccount();
  const remove = new Set((Array.isArray(trackIds) ? trackIds : []).map(String));
  const playlistId = String(id || "");
  if (!remove.size) return void 0;
  const response = await getPlaylist({ id: playlistId });
  const entries = entriesOf(response.playlist);
  const indexes = [];
  entries.forEach((song, index) => {
    if (remove.has(String(song.id))) indexes.push(index);
  });
  if (!indexes.length) return void 0;
  indexes.sort((a, b) => b - a);
  await updatePlaylist({ playlistId, songIndexToRemove: indexes });
  return void 0;
}
async function movePlaylistTrack({ id, from, to }) {
  requireAccount();
  const playlistId = String(id || "");
  const response = await getPlaylist({ id: playlistId });
  if (!response.playlist) throw unavailableFail(t("This playlist isn't on the server"));
  const entries = entriesOf(response.playlist);
  const fromIndex = Number(from);
  const toIndex = Number(to);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0 || fromIndex >= entries.length || toIndex >= entries.length) {
    throw unavailableFail(t("That song position doesn't exist in this playlist"));
  }
  if (fromIndex === toIndex) return void 0;
  if (entries.length > 400) {
    throw unavailableFail(t("This playlist is too long to reorder from MyGo Music; reorder it in Navidrome"));
  }
  const songIds = entries.map((song) => String(song.id));
  const [moved] = songIds.splice(fromIndex, 1);
  songIds.splice(toIndex, 0, moved);
  await createPlaylist({ playlistId, songIds });
  return void 0;
}
function recent() {
  return recentTracks();
}
async function played({ id }) {
  const config = readConfig();
  if (!config.server || !config.username || !config.password) return void 0;
  const trackId = String(id || "");
  if (!trackId) return void 0;
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
      await scrobble({ id: trackId, time: Date.now(), submission: "true" });
    } catch {
    }
  }
  return void 0;
}

// src/browse.js
var HOME_SIZE = 18;
var ALBUM_PAGE = 50;
var albumTypes = /* @__PURE__ */ new Map([
  ["newest", () => t("Recently added")],
  ["recent", () => t("Recently played")],
  ["frequent", () => t("Most played")],
  ["random", () => t("Random albums")],
  ["alphabeticalByName", () => t("Albums A to Z")],
  ["alphabeticalByArtist", () => t("Albums by artist")],
  ["starred", () => t("Favorite albums")]
]);
var albumsIn = (response) => {
  const albums = response && response.albumList2 && response.albumList2.album;
  return Array.isArray(albums) ? albums : [];
};
var artistsIn = (response) => {
  const artists = response && response.artists && response.artists.index;
  return Array.isArray(artists) ? artists : [];
};
var playlistsIn = (response) => {
  const playlists2 = response && response.playlists && response.playlists.playlist;
  return Array.isArray(playlists2) ? playlists2 : [];
};
function settle(tasks) {
  return Promise.allSettled(tasks).then((results) => {
    const rejected = results.filter((result) => result.status === "rejected");
    for (const result of rejected) {
      const code = result.reason && result.reason.code;
      if (code === "signIn" || code === "setup") throw result.reason;
    }
    if (rejected.length === results.length) throw rejected[0].reason;
    return results.map((result) => result.status === "fulfilled" ? result.value : null);
  });
}
function albumsSection(title, response, morePage, empty) {
  const section = { title, albums: albumsIn(response).map(toAlbum) };
  if (morePage) section.morePage = morePage;
  if (empty) section.empty = empty;
  return section;
}
async function home() {
  requireAccount();
  const [random, newest, recent2, frequent, starred, starred2, playlists2] = await settle([
    getRandomSongs({ size: 20 }),
    getAlbumList2({ type: "newest", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "recent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "frequent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "starred", size: HOME_SIZE, offset: 0 }),
    getStarred2(),
    getPlaylists()
  ]);
  const sections = [];
  const songs = random && Array.isArray(random.randomSongs && random.randomSongs.song) ? random.randomSongs.song : [];
  if (songs.length) {
    sections.push({
      title: t("Random picks"),
      pageTitle: t("Random picks"),
      subtitle: t("A fresh mix from your library"),
      tracks: songs.map(toTrack)
    });
  }
  if (newest) sections.push(albumsSection(t("Recently added"), newest, "albums:newest:18"));
  if (recent2) sections.push(albumsSection(t("Recently played"), recent2, "albums:recent:18"));
  if (frequent) sections.push(albumsSection(t("Most played"), frequent, "albums:frequent:18"));
  if (starred) sections.push(albumsSection(t("Favorite albums"), starred, "albums:starred:18", t("No favorite albums yet")));
  const favorites = starred2 && starred2.starred2 ? starred2.starred2 : {};
  const favoriteArtists = Array.isArray(favorites.artist) ? favorites.artist : [];
  if (favoriteArtists.length) {
    sections.push({ title: t("Favorite artists"), artists: favoriteArtists.map(toArtist) });
  }
  const lists = playlistsIn(playlists2).map((playlist2) => toPlaylist(playlist2));
  if (lists.length) {
    sections.push({ title: t("Playlists"), playlists: lists });
  } else if (playlists2) {
    sections.push({ title: t("Playlists"), empty: t("No playlists yet") });
  }
  return { sections };
}
async function browse({ page }) {
  requireAccount();
  const name = String(page || "");
  if (!name) return home();
  if (name === "albums") return albumsPage();
  const list = /^albums:([A-Za-z]+):(\d+)$/.exec(name);
  if (list) return albumListPage(list[1], Math.max(0, Number(list[2]) || 0));
  if (name === "artists") return artistsPage();
  if (name === "playlists") return playlistsPage();
  throw fail("unavailable", t("There's no such page"));
}
async function albumsPage() {
  const [newest, recent2, frequent, all] = await settle([
    getAlbumList2({ type: "newest", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "recent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "frequent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "alphabeticalByName", size: HOME_SIZE, offset: 0 })
  ]);
  const sections = [];
  if (newest) sections.push(albumsSection(t("Recently added"), newest, "albums:newest:18"));
  if (recent2) sections.push(albumsSection(t("Recently played"), recent2, "albums:recent:18"));
  if (frequent) sections.push(albumsSection(t("Most played"), frequent, "albums:frequent:18"));
  if (all) sections.push(albumsSection(t("All albums"), all, "albums:alphabeticalByName:18"));
  if (!sections.length) sections.push({ title: t("Albums"), empty: t("No albums in the library") });
  return { title: t("Albums"), sections };
}
async function albumListPage(type, offset) {
  const title = albumTypes.get(type);
  if (!title) throw fail("unavailable", t("There's no such page"));
  const response = await getAlbumList2({ type, size: ALBUM_PAGE, offset });
  const albums = albumsIn(response).map(toAlbum);
  const section = { title: title(), albums };
  if (albums.length === ALBUM_PAGE) section.morePage = `albums:${type}:${offset + ALBUM_PAGE}`;
  if (!sectionsHave(section)) section.empty = t("No albums here");
  return { title: title(), sections: [section] };
}
var sectionsHave = (section) => Array.isArray(section.albums) && section.albums.length > 0;
async function artistsPage() {
  const response = await getArtists();
  const indexes = artistsIn(response);
  const sections = indexes.map((index) => ({
    title: String(index && index.name || ""),
    artists: (Array.isArray(index && index.artist) ? index.artist : []).map(toArtist)
  })).filter((section) => section.artists.length > 0);
  if (!sections.length) sections.push({ title: t("Artists"), empty: t("No artists in the library") });
  return { title: t("Artists"), sections };
}
async function playlistsPage() {
  const response = await getPlaylists();
  const all = playlistsIn(response).map((playlist2) => toPlaylist(playlist2));
  const mine = all.filter((playlist2) => playlist2.mine);
  const saved = all.filter((playlist2) => !playlist2.mine);
  const sections = [
    { title: t("My playlists"), playlists: mine, empty: t("You haven't made a playlist yet") }
  ];
  if (saved.length) sections.push({ title: t("Saved playlists"), playlists: saved });
  return { title: t("Playlists"), sections };
}

// src/playback.js
var suffixFormats = /* @__PURE__ */ new Map([
  ["mp3", { type: "mp3", lossless: false }],
  ["flac", { type: "flac", lossless: true }],
  ["ogg", { type: "ogg", lossless: false }],
  ["oga", { type: "ogg", lossless: false }],
  ["wav", { type: "wav", lossless: true }],
  ["wave", { type: "wav", lossless: true }],
  ["m4a", { type: "m4a", lossless: true }],
  ["m4b", { type: "m4a", lossless: true }],
  ["mp4", { type: "m4a", lossless: true }],
  ["alac", { type: "m4a", lossless: true }],
  ["aac", { type: "aac", lossless: false }]
]);
var unsupported = /* @__PURE__ */ new Set(["ape", "wv", "wma", "aiff", "aif", "mp1", "mp2", "opus", "dsf", "dff"]);
var mimeFormats = /* @__PURE__ */ new Map([
  ["audio/mpeg", { type: "mp3", lossless: false }],
  ["audio/mp3", { type: "mp3", lossless: false }],
  ["audio/flac", { type: "flac", lossless: true }],
  ["audio/x-flac", { type: "flac", lossless: true }],
  ["application/flac", { type: "flac", lossless: true }],
  ["audio/ogg", { type: "ogg", lossless: false }],
  ["application/ogg", { type: "ogg", lossless: false }],
  ["audio/vorbis", { type: "ogg", lossless: false }],
  ["audio/wav", { type: "wav", lossless: true }],
  ["audio/wave", { type: "wav", lossless: true }],
  ["audio/x-wav", { type: "wav", lossless: true }],
  ["audio/mp4", { type: "m4a", lossless: true }],
  ["audio/x-m4a", { type: "m4a", lossless: true }],
  ["audio/aac", { type: "aac", lossless: false }],
  ["audio/x-aac", { type: "aac", lossless: false }]
]);
var codecOf = (contentType) => {
  const found = /\bcodecs\s*=\s*"?([^";]+)/i.exec(String(contentType || ""));
  return found ? found[1].trim().toLowerCase() : "";
};
function sourceFormat(song) {
  const suffix = String(song && song.suffix || "").trim().toLowerCase();
  const contentType = String(song && song.contentType || "").toLowerCase();
  const codec = codecOf(contentType);
  const mime = contentType.split(";")[0].trim();
  if (unsupported.has(suffix)) return null;
  if ((suffix === "ogg" || suffix === "oga" || mime === "audio/ogg" || mime === "application/ogg") && codec) {
    if (codec !== "vorbis") return null;
  }
  if (suffix && suffixFormats.has(suffix)) {
    const format = suffixFormats.get(suffix);
    if (format.type === "m4a" && codec && !["alac", "flac", "aac", "mp4a.40", "mp4a.40.2"].some((known) => codec.includes(known))) {
      return null;
    }
    return format;
  }
  if (mime && mimeFormats.has(mime)) {
    const format = mimeFormats.get(mime);
    if (format.type === "m4a" && codec && !["alac", "flac", "aac", "mp4a.40", "mp4a.40.2"].some((known) => codec.includes(known))) {
      return null;
    }
    return format;
  }
  return null;
}
async function stream({ id, quality = "high" }) {
  const config = requireAccount();
  const trackId = String(id || "");
  const response = await getSong({ id: trackId });
  const song = response.song;
  if (!song) throw unavailableFail(t("This track isn't on the server"));
  if (song.isVideo) throw unavailableFail(t("This is a video, which the player can't play"));
  const format = sourceFormat(song);
  const params = { id: trackId };
  let type = "mp3";
  if (quality === "lossless" && format) {
    type = format.type;
    params.format = "raw";
  } else {
    params.format = "mp3";
    params.maxBitRate = quality === "standard" ? 128 : 320;
    type = "mp3";
  }
  return {
    url: mediaApiUrl("stream", params, config),
    type,
    headers: requestHeaders(config, { json: false })
  };
}

// src/lyrics.js
function timedLines(response) {
  const list = response && response.lyricsList && response.lyricsList.structuredLyrics;
  const entries = Array.isArray(list) ? list : list ? [list] : [];
  for (const entry of entries) {
    const lines = Array.isArray(entry && entry.line) ? entry.line : [];
    if (!lines.length) continue;
    if (entry.synced === false) continue;
    const mapped = [];
    for (const line of lines) {
      const start = Number(line && line.start);
      if (!Number.isFinite(start)) continue;
      const text = String(line && line.value || "");
      mapped.push({ start: Math.max(0, Math.round(start)), text });
    }
    if (mapped.length) return mapped;
  }
  return [];
}
async function lyrics({ id }) {
  requireAccount();
  const trackId = String(id || "");
  try {
    const timed = await getLyricsBySongId({ id: trackId });
    const lines = timedLines(timed);
    if (lines.length) return { lines };
    const list = timed && timed.lyricsList && timed.lyricsList.structuredLyrics;
    const entries = Array.isArray(list) ? list : list ? [list] : [];
    for (const entry of entries) {
      const lines2 = Array.isArray(entry && entry.line) ? entry.line : [];
      const text = lines2.map((line) => String(line && line.value || "")).filter(Boolean);
      if (text.length) return { lrc: text.join("\n") };
    }
  } catch (error) {
    if (error && error.code === "setup") throw error;
  }
  try {
    const song = await getSong({ id: trackId });
    const details = song.song || {};
    if (details.artist && details.title) {
      const old = await getLyrics({ artist: String(details.artist), title: String(details.title) });
      const value = old && old.lyrics && old.lyrics.value;
      if (typeof value === "string" && value.trim()) return { lrc: value };
    }
  } catch (error) {
    if (error && (error.code === "setup" || error.code === "signIn")) throw error;
  }
  throw unavailableFail(t("This song has no lyrics"));
}

// src/index.js
function account() {
  const config = readConfig();
  if (!config.server || !config.username || !config.password) return null;
  return { id: config.username, name: config.username };
}
async function signIn() {
  const config = requireAccount();
  await ping();
  return { id: config.username, name: config.username };
}
function signOut() {
  invalidateCaches();
  forgetMediaAuth();
  forgetTrackShapes();
  forgetRecent();
  return void 0;
}
function setSetting({ key }) {
  invalidateCaches();
  forgetMediaAuth();
  forgetTrackShapes();
  if (key === "server" || key === "username" || key === "password") forgetRecent();
  return void 0;
}
export {
  account,
  addToPlaylist,
  album,
  artist,
  browse,
  createPlaylist2 as createPlaylist,
  deletePlaylist2 as deletePlaylist,
  followArtist,
  home,
  isLiked,
  like,
  liked,
  lyrics,
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
  setSetting,
  signIn,
  signOut,
  stream,
  suggest
};
