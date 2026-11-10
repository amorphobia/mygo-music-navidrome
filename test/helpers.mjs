// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Shared harness for the Navidrome plugin tests.
//
// The plugin is a single ES module bundled at the repo root (index.js). Tests
// load it black-box: a mocked `host` global and a mocked global `fetch` that
// records every request, so assertions are about what the plugin asks the
// Subsonic server for and what it maps the answers to.
//
// No network, no host app, and no third-party dependencies: node: test only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(TEST_DIR, "..");
export const BUNDLE_PATH = path.join(ROOT, "index.js");
export const MANIFEST_PATH = path.join(ROOT, "plugin.json");

/** The Subsonic API version the plugin is expected to send. */
export const SUBSONIC_VERSION = "1.16.1";
/** The Subsonic client name the plugin is expected to send. */
export const CLIENT_NAME = "mygo-music-navidrome";

let importCounter = 0;

export function md5(text) {
  return createHash("md5").update(String(text), "utf8").digest("hex");
}

export function bundleExists() {
  return existsSync(BUNDLE_PATH);
}

/** The settings a working server has; individual tests override them. */
export function goodSettings(overrides = {}) {
  return {
    server: "https://music.example.com",
    username: "alice",
    password: "s3cret",
    cfAccessClientId: "",
    cfAccessClientSecret: "",
    authorization: "",
    cookie: "",
    customHeaders: "",
    scrobble: "",
    ...overrides,
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function headerEntries(headers) {
  const out = {};
  if (!headers) return out;
  const push = (name, value) => {
    const key = String(name).toLowerCase();
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  };
  if (typeof headers.forEach === "function" && typeof headers.get === "function") {
    headers.forEach((value, key) => push(key, value));
    return out;
  }
  if (Array.isArray(headers)) {
    for (const pair of headers) push(pair[0], pair[1]);
    return out;
  }
  for (const [key, value] of Object.entries(headers)) push(key, value);
  return out;
}

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === "string") return input.url;
  throw new TypeError(`mock fetch: can't read a URL from ${String(input)}`);
}

function apiMethodOf(url) {
  const match = url.pathname.match(/\/rest\/([^/]+)\/?$/);
  if (!match) return undefined;
  return match[1].replace(/\.view$/i, "");
}

/**
 * A recording mock of the global fetch. `route` decides the answer:
 *  - a Response instance is returned as is;
 *  - `{json, status?, headers?}` answers JSON;
 *  - `{text, status?, contentType?}` answers text;
 *  - `{html, status?}` answers text/html (what a Cloudflare Access page is);
 *  - `{bytes, contentType?, status?}` answers binary (covers, audio);
 *  - `{status, body?}` answers an empty response of that status;
 *  - any other plain object is a Subsonic envelope and answers as JSON.
 * A route that throws rejects the fetch, as a network error would.
 */
export function mockFetch(route) {
  const requests = [];
  const responses = [];
  let current = route;

  const fetchImpl = async (input, init = {}) => {
    const urlString = urlOf(input);
    const url = new URL(urlString);
    const httpMethod = String(
      init.method || (input && typeof input === "object" && input.method) || "GET",
    ).toUpperCase();
    const headers = headerEntries(
      init.headers || (input && typeof input === "object" && input.headers),
    );
    let body = init.body;
    const params = Object.fromEntries(url.searchParams);
    // A form-encoded body is how a Subsonic POST carries its parameters; fold
    // it in so tests read one set of params either way.
    if (body && typeof body === "string" && /application\/x-www-form-urlencoded/i.test(headers["content-type"] || "")) {
      for (const [key, value] of new URLSearchParams(body)) {
        if (!(key in params)) params[key] = value;
      }
    }
    const request = {
      url: urlString,
      urlObject: url,
      pathname: url.pathname,
      httpMethod,
      apiMethod: apiMethodOf(url),
      params,
      // Repeated parameters (songIdToAdd, songIndexToRemove, scrobble id, ...).
      paramsAll: [...url.searchParams],
      headers,
      body,
      /** The values of a parameter, in order, when it may repeat. */
      paramValues(key) {
        return url.searchParams.getAll(String(key));
      },
      header(name) {
        const found = headers[String(name).toLowerCase()];
        return found === undefined ? null : found;
      },
    };
    requests.push(request);
    const answer = await current(request);
    if (answer instanceof Error) throw answer;
    const response = toResponse(answer, request);
    responses.push(response);
    return response;
  };

  return {
    fetch: fetchImpl,
    requests,
    responses,
    /** Replace the route function for requests from now on. */
    respond(fn) {
      current = fn;
    },
    route() {
      return current;
    },
  };
}

function toResponse(answer, request) {
  if (answer instanceof Response) return answer;
  if (answer === undefined || answer === null) {
    return new Response(`mock fetch: no answer routed for ${request.httpMethod} ${request.url}`, {
      status: 599,
      headers: { "content-type": "text/plain" },
    });
  }
  if (typeof answer === "string") {
    return new Response(answer, { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (answer instanceof Error) throw answer;
  const { json, text, html, bytes, status = 200, contentType = "", headers = {} } = answer;
  if (json !== undefined) {
    return new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });
  }
  if (html !== undefined) {
    return new Response(html, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", ...headers },
    });
  }
  if (text !== undefined) {
    return new Response(text, {
      status,
      headers: { "content-type": contentType || "text/plain; charset=utf-8", ...headers },
    });
  }
  if (bytes !== undefined) {
    return new Response(bytes, {
      status,
      headers: { "content-type": contentType || "application/octet-stream", ...headers },
    });
  }
  if ("status" in answer || "body" in answer) {
    return new Response(answer.body ?? null, { status, headers });
  }
  // A raw Subsonic envelope, the common case.
  return new Response(JSON.stringify(answer), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * The `host` global the app installs. Settings are strings (empty string when
 * unset); storage is JSON values; crypto.md5 is real md5.
 */
export function mockHost(opts = {}) {
  const settings = { ...(opts.settings || {}) };
  const language = opts.language || "en";
  const storageData = clone(opts.storage || {}) || {};
  const tCalls = [];
  const storageOps = [];
  const openedUrls = [];
  const prompts = [];

  let translations = null;
  if (language !== "en") {
    try {
      translations = readLocale(language);
    } catch {
      translations = null;
    }
  }

  const host = {
    platform: opts.platform || process.platform,
    arch: opts.arch || process.arch,
    dir: opts.dir || ROOT,
    dataDir: opts.dataDir || path.join(ROOT, ".test-data"),
    setting(key) {
      const value = settings[String(key)];
      return value === undefined || value === null ? "" : String(value);
    },
    storage: {
      get(key) {
        const name = String(key);
        storageOps.push({ op: "get", key: name });
        return clone(storageData[name]) ?? null;
      },
      set(key, value) {
        const name = String(key);
        storageData[name] = clone(value);
        storageOps.push({ op: "set", key: name });
      },
      remove(key) {
        const name = String(key);
        delete storageData[name];
        storageOps.push({ op: "remove", key: name });
      },
    },
    crypto: {
      md5: (text) => md5(text),
      aesEcbEncrypt: () => {
        throw new Error("aesEcbEncrypt is not used by this plugin's tests");
      },
    },
    t(text) {
      const source = String(text);
      tCalls.push(source);
      if (translations && typeof translations[source] === "string") return translations[source];
      return source;
    },
    language: () => language,
    openURL(url) {
      openedUrls.push(url);
      return undefined;
    },
    signInPrompt(prompt) {
      prompts.push(prompt);
    },
    waitForRedirect() {
      throw new Error("waitForRedirect is not used by this plugin's tests");
    },
    webSignIn() {
      throw new Error("webSignIn is not used by this plugin's tests");
    },
    spawn() {
      throw new Error("spawn is not used by this plugin's tests");
    },
    ...(opts.overrides || {}),
  };

  // Not part of the real host: tests read the storage the plugin kept.
  Object.defineProperty(host, "__dumpStorage", {
    value: () => clone(storageData),
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(host, "__settings", {
    value: settings,
    enumerable: false,
    configurable: true,
  });

  return { host, settings, storageData, tCalls, storageOps, openedUrls, prompts };
}

async function importBundle() {
  if (!bundleExists()) {
    throw new Error(
      `index.js is not built yet (${BUNDLE_PATH}). Run \`npm run build\` before the behavior tests.`,
    );
  }
  importCounter += 1;
  // The bundle keeps module-level state and caches, so every load gets a
  // distinct module instance.
  const url = `${pathToFileURL(BUNDLE_PATH).href}?instance=${process.pid}-${importCounter}`;
  return import(url);
}

/**
 * Load a fresh instance of the built plugin with a mocked host and fetch.
 *
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.settings] settings on top of goodSettings()
 * @param {Record<string,unknown>} [opts.storage] host.storage contents
 * @param {(req: object) => unknown} [opts.route] fetch route; defaults to the
 *   good sample database
 * @param {"en"|"zh-CN"} [opts.language]
 * @param {object} [opts.hostOverrides] extra fields on the host mock
 * @returns {Promise<{plugin: object, host: object, requests: object[], responses: Response[], respond: Function, fetch: Function, settings: object}>}
 */
export async function loadPlugin(opts = {}) {
  const settings = goodSettings(opts.settings);
  const db = opts.db || makeDb();
  const { host, tCalls, storageData, storageOps, openedUrls, prompts } = mockHost({
    settings,
    storage: opts.storage,
    language: opts.language,
    overrides: opts.hostOverrides,
  });
  const route = opts.route || makeRoutes(db);
  const mock = mockFetch(route);

  globalThis.host = host;
  globalThis.fetch = mock.fetch;

  const plugin = await importBundle();
  return {
    plugin,
    host,
    requests: mock.requests,
    responses: mock.responses,
    respond: mock.respond,
    fetch: mock.fetch,
    settings,
    db,
    tCalls,
    storageData,
    storageOps,
    openedUrls,
    prompts,
  };
}

// ---------------------------------------------------------------------------
// Subsonic fixtures
// ---------------------------------------------------------------------------

export function ok(body = {}) {
  return { "subsonic-response": { status: "ok", version: SUBSONIC_VERSION, ...body } };
}

export function failed(code, message) {
  return {
    "subsonic-response": {
      status: "failed",
      version: SUBSONIC_VERSION,
      error: { code, message },
    },
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MP3_SIGNATURE = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00];

export function pngBytes() {
  return new Uint8Array([...PNG_SIGNATURE, ...new TextEncoder().encode("navidrome-test-png")]);
}

export function mp3Bytes() {
  return new Uint8Array([...MP3_SIGNATURE, ...new TextEncoder().encode("navidrome-test-mp3")]);
}

/** One song, with every field a normal Navidrome 0.5x OpenSubsonic server sends. */
export const SONG_BASE = {
  id: "song-1",
  parent: "album-1",
  isDir: false,
  title: "First Light",
  album: "Dawn",
  artist: "The Rays",
  track: 1,
  year: 2024,
  genre: "Rock",
  coverArt: "al-1",
  size: 4500000,
  contentType: "audio/mpeg",
  suffix: "mp3",
  duration: 245,
  bitRate: 320,
  path: "The Rays/Dawn/01 - First Light.mp3",
  albumId: "album-1",
  artistId: "artist-1",
  type: "music",
  discNumber: 1,
  starred: "2024-01-01T00:00:00Z",
  artists: [{ id: "artist-1", name: "The Rays" }],
  albumArtists: [{ id: "artist-1", name: "The Rays" }],
};

export const ALBUM_BASE = {
  id: "album-1",
  name: "Dawn",
  artist: "The Rays",
  artistId: "artist-1",
  coverArt: "al-1",
  songCount: 2,
  duration: 547,
  playCount: 12,
  created: "2024-05-01T10:00:00Z",
  year: 2024,
  genre: "Rock",
  starred: "2024-01-02T00:00:00Z",
  artists: [{ id: "artist-1", name: "The Rays" }],
};

export const ARTIST_BASE = {
  id: "artist-1",
  name: "The Rays",
  albumCount: 1,
  coverArt: "artist-1",
  starred: "2024-01-03T00:00:00Z",
};

/** The sample library the default route serves. */
export function makeDb() {
  const song = (overrides) => ({ ...SONG_BASE, ...overrides });
  const album = (overrides) => ({ ...ALBUM_BASE, ...overrides });
  const artist = (overrides) => ({ ...ARTIST_BASE, ...overrides });

  const songs = [
    song(),
    song({ id: "song-2", title: "Second Wind", suffix: "flac", contentType: "audio/flac", duration: 302, track: 2, size: 52000000, path: "The Rays/Dawn/02 - Second Wind.flac" }),
    song({
      id: "song-3", title: "Ape Escape", album: "Ape Album", albumId: "album-3",
      artist: "Other Band", artistId: "artist-2", suffix: "ape", contentType: "audio/ape",
      duration: 180, track: 1, coverArt: undefined, bitRate: 900,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
    song({
      id: "song-4", title: "Winter Wma", album: "Ape Album", albumId: "album-3",
      artist: "Other Band", artistId: "artist-2", suffix: "wma", contentType: "audio/x-ms-wma",
      duration: 200, track: 2, coverArt: undefined, bitRate: 192,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
    song({
      id: "song-5", title: "Nightfall Eyes", album: "Nightfall", albumId: "album-2",
      artist: "Other Band", artistId: "artist-2", suffix: "m4a", contentType: "audio/mp4",
      duration: 210, track: 1, coverArt: "al-2", bitRate: 256,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
    song({
      id: "song-6", title: "Opus Ogg", album: "Nightfall", albumId: "album-2",
      artist: "Other Band", artistId: "artist-2", suffix: "ogg", contentType: "audio/ogg; codecs=opus",
      duration: 190, track: 2, coverArt: "al-2", bitRate: 160,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
    song({
      id: "song-7", title: "Ocean Wave", album: "Nightfall", albumId: "album-2",
      artist: "Other Band", artistId: "artist-2", suffix: "wav", contentType: "audio/wav",
      duration: 220, track: 3, coverArt: "al-2", bitRate: 1411,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
    song({
      id: "song-8", title: "Aiff Dream", album: "Ape Album", albumId: "album-3",
      artist: "Other Band", artistId: "artist-2", suffix: "aiff", contentType: "audio/aiff",
      duration: 205, track: 3, coverArt: undefined, bitRate: 1411,
      artists: [{ id: "artist-2", name: "Other Band" }],
      albumArtists: [{ id: "artist-2", name: "Other Band" }],
      starred: undefined,
    }),
  ];

  const albums = [
    album(),
    album({
      id: "album-2", name: "Nightfall", artist: "Other Band", artistId: "artist-2",
      coverArt: "al-2", songCount: 4, duration: 825, playCount: 3,
      created: "2024-06-01T10:00:00Z", year: 2023,
      artists: [{ id: "artist-2", name: "Other Band" }], starred: undefined,
    }),
    album({
      id: "album-3", name: "Ape Album", artist: "Other Band", artistId: "artist-2",
      coverArt: undefined, songCount: 3, duration: 585, playCount: 1,
      created: "2023-11-01T10:00:00Z", year: 2022,
      artists: [{ id: "artist-2", name: "Other Band" }], starred: undefined,
    }),
    album({
      id: "album-4", name: "Slow Burn", artist: "The Rays", artistId: "artist-1",
      coverArt: "al-4", songCount: 5, duration: 900, playCount: 40,
      created: "2022-03-01T10:00:00Z", year: 2021,
      artists: [{ id: "artist-1", name: "The Rays" }], starred: undefined,
    }),
    album({
      id: "album-5", name: "Golden Hour", artist: "Solo Act", artistId: "artist-3",
      coverArt: "al-5", songCount: 6, duration: 1000, playCount: 25,
      created: "2024-07-01T10:00:00Z", year: 2024,
      artists: [{ id: "artist-3", name: "Solo Act" }], starred: undefined,
    }),
  ];

  const artists = [
    artist(),
    artist({ id: "artist-2", name: "Other Band", albumCount: 2, coverArt: "artist-2", starred: undefined }),
    artist({ id: "artist-3", name: "Solo Act", albumCount: 1, coverArt: "artist-3", starred: undefined }),
  ];

  return {
    songs,
    albums,
    artists,
    starred: {
      songs: ["song-1", "song-2"],
      albums: ["album-1"],
      artists: ["artist-1"],
    },
    randomSongs: ["song-2", "song-5", "song-7"],
    topSongs: ["song-2", "song-1"],
    artistIndex: [
      { name: "O", artist: ["artist-2"] },
      { name: "S", artist: ["artist-3"] },
      { name: "T", artist: ["artist-1"] },
    ],
    recentAlbumIds: ["album-2", "album-1", "album-5"],
    frequentAlbumIds: ["album-4", "album-5"],
    lyrics: {
      "song-1": {
        displayArtist: "The Rays",
        displayTitle: "First Light",
        lang: "en",
        synced: true,
        line: [
          { start: 0, value: "First line" },
          { start: 3000, value: "Second line" },
        ],
      },
      "song-2": {
        displayArtist: "The Rays",
        displayTitle: "Second Wind",
        lang: "en",
        synced: false,
        line: [{ value: "Unsynced first" }, { value: "Unsynced second" }],
      },
    },
    plainLyrics: {
      "Other Band": { artist: "Other Band", title: "Nightfall Eyes", value: "Plain first\nPlain second" },
    },
    playlists: [
      {
        id: "playlist-1",
        name: "Road Trip",
        owner: "alice",
        public: true,
        songCount: 2,
        duration: 547,
        created: "2024-01-01T00:00:00Z",
        changed: "2024-01-02T00:00:00Z",
        coverArt: "pl-1",
        entry: [{ id: "song-1" }, { id: "song-2" }],
      },
      {
        id: "playlist-2",
        name: "Shared Mix",
        owner: "bob",
        public: false,
        songCount: 1,
        duration: 210,
        created: "2024-02-01T00:00:00Z",
        changed: "2024-02-02T00:00:00Z",
        entry: [{ id: "song-5" }],
      },
    ],
    scrobbles: [],
    createdPlaylists: [],
    calls: {},
    playlistSeq: 2,
    currentUser: "alice",
  };
}

function numberParam(params, ...names) {
  for (const name of names) {
    if (params[name] !== undefined && params[name] !== "") return Number(params[name]);
  }
  return undefined;
}

function songById(db, id) {
  return db.songs.find((s) => s.id === id);
}

function albumById(db, id) {
  return db.albums.find((a) => a.id === id);
}

function artistById(db, id) {
  return db.artists.find((a) => a.id === id);
}

function playlistById(db, id) {
  return db.playlists.find((p) => p.id === id);
}

/**
 * The sample Subsonic server: a route function over a mutable database.
 * Every request is recorded both by the mock fetch and in db.calls.
 */
export function makeRoutes(db = makeDb()) {
  return async function route(req) {
    const method = req.apiMethod;
    const p = req.params;
    if (!method) {
      throw new Error(`mock route: not a Subsonic URL: ${req.url}`);
    }
    db.calls[method] = db.calls[method] || [];
    db.calls[method].push(req);
    db.__lastParams = p;

    switch (method) {
      case "ping":
        return ok();
      case "getRandomSongs": {
        const size = numberParam(p, "size") ?? db.randomSongs.length;
        return ok({ randomSongs: { song: selectSongs(db, db.randomSongs, size) } });
      }
      case "getTopSongs":
        return ok({ topSongs: { song: selectSongs(db, db.topSongs, numberParam(p, "count") ?? 50) } });
      case "getArtists":
        return ok({
          artists: {
            index: (db.artistIndex || []).map((index) => ({
              name: index.name,
              artist: (index.artist || []).map((id) => artistById(db, id)).filter(Boolean),
            })),
          },
        });
      case "getAlbumList2": {
        const type = p.type || "";
        let ids;
        switch (type) {
          case "newest":
            ids = [...db.albums].sort((a, b) => String(b.created).localeCompare(String(a.created))).map((a) => a.id);
            break;
          case "recent":
            ids = db.recentAlbumIds;
            break;
          case "frequent":
            ids = db.frequentAlbumIds;
            break;
          case "alphabeticalByName":
            ids = [...db.albums].sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.id);
            break;
          case "starred":
            ids = db.starred.albums;
            break;
          case "random":
            ids = [...db.albums].map((a) => a.id).reverse();
            break;
          default:
            return failed(0, `Unknown list type: ${type}`);
        }
        const size = numberParam(p, "size") ?? 20;
        const offset = numberParam(p, "offset") ?? 0;
        const albums = ids.map((id) => albumById(db, id)).filter(Boolean).slice(offset, offset + size);
        return ok({ albumList2: { album: albums } });
      }
      case "getAlbum": {
        const album = albumById(db, p.id);
        if (!album) return failed(70, "Album not found");
        // OpenSubsonic's AlbumID3WithSongs: the songs are album.song[].
        return ok({
          album: {
            ...album,
            song: db.songs.filter((s) => s.albumId === album.id),
          },
        });
      }
      case "getArtist": {
        const artist = artistById(db, p.id);
        if (!artist) return failed(70, "Artist not found");
        return ok({
          artist: { ...artist, album: db.albums.filter((a) => a.artistId === artist.id) },
        });
      }
      case "search3": {
        const query = String(p.query || "").trim();
        const matches = (text) => query === "" || query === "*" || String(text).toLowerCase().includes(query.toLowerCase());
        const songs = db.songs.filter((s) => matches(`${s.title} ${s.artist} ${s.album}`));
        const albums = db.albums.filter((a) => matches(`${a.name} ${a.artist}`));
        const artists = db.artists.filter((a) => matches(a.name));
        const songCount = numberParam(p, "songCount") ?? 30;
        const songOffset = numberParam(p, "songOffset") ?? 0;
        const albumCount = numberParam(p, "albumCount") ?? 30;
        const albumOffset = numberParam(p, "albumOffset") ?? 0;
        const artistCount = numberParam(p, "artistCount") ?? 30;
        const artistOffset = numberParam(p, "artistOffset") ?? 0;
        return ok({
          searchResult3: {
            song: songs.slice(songOffset, songOffset + songCount),
            album: albums.slice(albumOffset, albumOffset + albumCount),
            artist: artists.slice(artistOffset, artistOffset + artistCount),
          },
        });
      }
      case "getStarred2":
        return ok({
          starred2: {
            song: db.starred.songs.map((id) => songById(db, id)).filter(Boolean),
            album: db.starred.albums.map((id) => albumById(db, id)).filter(Boolean),
            artist: db.starred.artists.map((id) => artistById(db, id)).filter(Boolean),
          },
        });
      case "getSong": {
        const song = songById(db, p.id);
        if (!song) return failed(70, "Song not found");
        return ok({ song });
      }
      case "getPlaylists":
        return ok({ playlists: { playlist: db.playlists } });
      case "getPlaylist": {
        const playlist = playlistById(db, p.id);
        if (!playlist) return failed(70, "Playlist not found");
        return ok({
          playlist: {
            ...playlist,
            entry: (playlist.entry || []).map((e) => songById(db, e.id)).filter(Boolean),
          },
        });
      }
      case "createPlaylist": {
        // With playlistId and songId, createPlaylist replaces a playlist's
        // order — that's how movePlaylistTrack reorders.
        if (p.playlistId) {
          const playlist = playlistById(db, p.playlistId);
          if (!playlist) return failed(70, "Playlist not found");
          const ids = p.songId === undefined ? [] : Array.isArray(p.songId) ? p.songId : [p.songId];
          playlist.entry = ids.map((id) => ({ id }));
          playlist.songCount = ids.length;
          return ok();
        }
        db.playlistSeq += 1;
        const playlist = {
          id: `playlist-${db.playlistSeq}`,
          name: p.name || "New Playlist",
          owner: db.currentUser,
          public: false,
          songCount: 0,
          duration: 0,
          created: new Date(0).toISOString(),
          changed: new Date(0).toISOString(),
          entry: [],
        };
        if (p.songId) {
          const ids = Array.isArray(p.songId) ? p.songId : [p.songId];
          playlist.entry = ids.map((id) => ({ id }));
          playlist.songCount = ids.length;
        }
        db.playlists.push(playlist);
        db.createdPlaylists.push({ params: p, playlist });
        return ok({ playlist });
      }
      case "updatePlaylist": {
        const playlist = playlistById(db, p.playlistId || p.id);
        if (!playlist) return failed(70, "Playlist not found");
        if (p.name) playlist.name = Array.isArray(p.name) ? p.name[0] : p.name;
        const adds = p.songIdToAdd === undefined ? [] : Array.isArray(p.songIdToAdd) ? p.songIdToAdd : [p.songIdToAdd];
        const removes = p.songIndexToRemove === undefined ? [] : Array.isArray(p.songIndexToRemove) ? p.songIndexToRemove : [p.songIndexToRemove];
        for (const index of removes.map(Number).sort((a, b) => b - a)) playlist.entry.splice(index, 1);
        for (const id of adds) playlist.entry.push({ id });
        playlist.songCount = playlist.entry.length;
        return ok();
      }
      case "deletePlaylist": {
        const id = p.id;
        const index = db.playlists.findIndex((pl) => pl.id === id);
        if (index < 0) return failed(70, "Playlist not found");
        db.playlists.splice(index, 1);
        return ok();
      }
      case "star":
      case "unstar": {
        const on = method === "star";
        if (p.id) toggle(db.starred.songs, p.id, on);
        if (p.albumId) toggle(db.starred.albums, p.albumId, on);
        if (p.artistId) toggle(db.starred.artists, p.artistId, on);
        return ok();
      }
      case "scrobble": {
        const ids = Array.isArray(p.id) ? p.id : [p.id];
        for (const id of ids) {
          db.scrobbles.push({ id, submission: p.submission, time: p.time, params: p });
        }
        return ok();
      }
      case "getCoverArt":
        return { bytes: pngBytes(), contentType: "image/png" };
      case "stream":
        return { bytes: mp3Bytes(), contentType: "audio/mpeg" };
      case "getLyricsBySongId": {
        const lyrics = db.lyrics[p.id];
        return lyrics ? ok({ lyricsList: { structuredLyrics: [lyrics] } }) : failed(10, "Lyrics not found");
      }
      case "getLyrics": {
        const byArtist = db.plainLyrics[p.artist] || db.plainLyrics[p.id];
        return byArtist && (!p.title || byArtist.title === p.title)
          ? ok({ lyrics: byArtist })
          : failed(10, "Lyrics not found");
      }
      default:
        throw new Error(`mock route: unexpected Subsonic method "${method}" (${req.url})`);
    }
  };
}

function toggle(list, value, on) {
  const index = list.indexOf(value);
  if (on && index < 0) list.push(value);
  if (!on && index >= 0) list.splice(index, 1);
}

function selectSongs(db, ids, count) {
  return ids.map((id) => songById(db, id)).filter(Boolean).slice(0, count);
}

/**
 * Layer per-method overrides on a base route. An override is a function of the
 * request; it may return undefined to fall through to the base route.
 */
export function overrideRoute(base, overrides) {
  return async function route(req) {
    const override = overrides[req.apiMethod];
    if (override) {
      const answer = await override(req);
      if (answer !== undefined) return answer;
    }
    return base(req);
  };
}

/** A route that always answers the given spec (e.g. a failure). */
export function fixedRoute(answer) {
  return () => answer;
}

// ---------------------------------------------------------------------------
// Request assertions
// ---------------------------------------------------------------------------

/** Every recorded request of a Subsonic method. */
export function apiRequests(requests, method) {
  return requests.filter((req) => req.apiMethod === method);
}

/** The recorded requests of a method; fails with a helpful message when none. */
export function requestsOf(requests, method) {
  const found = apiRequests(requests, method);
  assert.ok(
    found.length > 0,
    `expected a Subsonic "${method}" request, but the plugin asked for: ${
      [...new Set(requests.map((r) => r.apiMethod || r.url))].join(", ") || "(nothing)"
    }`,
  );
  return found;
}

/** Exactly one recorded request of a method. */
export function oneRequest(requests, method) {
  const found = requestsOf(requests, method);
  assert.equal(found.length, 1, `expected exactly one "${method}" request, got ${found.length}`);
  return found[0];
}

/**
 * Assert the Subsonic auth parameters every request carries: u, s (a random
 * salt), t = md5(password + salt), v, c and f.
 */
export function assertAuth(req, { username, password } = {}) {
  const params = req.params;
  const name = req.apiMethod || req.url;
  assert.equal(params.u, username, `${name}: u is the username`);
  assert.match(
    String(params.s || ""),
    /^[A-Za-z0-9._~-]+$/,
    `${name}: s is a salt (got ${JSON.stringify(params.s)})`,
  );
  assert.match(String(params.t || ""), /^[0-9a-f]{32}$/, `${name}: t is a lowercase md5 hex digest`);
  assert.equal(params.t, md5(String(password) + String(params.s)), `${name}: t is md5(password + salt)`);
  assert.equal(params.v, SUBSONIC_VERSION, `${name}: v is the Subsonic API version`);
  assert.equal(params.c, CLIENT_NAME, `${name}: c is the plugin's client name`);
  assert.equal(params.f, "json", `${name}: f=json`);
}

/** True when the query of a URL has the parameter with the given value. */
export function hasParam(url, name, value) {
  const u = new URL(url);
  return u.searchParams.get(name) === value;
}

// ---------------------------------------------------------------------------
// Manifest & locales
// ---------------------------------------------------------------------------

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

export function readLocale(language) {
  const file = path.join(ROOT, "locales", `${language}.json`);
  if (!existsSync(file)) {
    throw new Error(`missing locale file: ${path.relative(ROOT, file)}`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export function localeExists(language) {
  return existsSync(path.join(ROOT, "locales", `${language}.json`));
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Run an async call and return the thrown error, failing the test if none. */
export async function throwsAsync(fn, message) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail(message || "expected the call to throw");
}

/** The code a plugin error carries, or undefined. */
export function errorCode(error) {
  return error && typeof error === "object" ? error.code : undefined;
}

/** Skips the suite when the bundle isn't built yet. */
export function bundleSkip() {
  return bundleExists() ? false : "index.js is not built yet; run `npm run build` first";
}

/**
 * Lets fire-and-forget work settle: account() starts the native detection
 * without awaiting it, so tests give it a turn of the event loop.
 */
export function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Titles of the sections of a Browse answer. */
export function sectionTitles(browse) {
  return (browse?.sections || []).map((s) => s.title || "");
}

/** All items of a Browse answer by their kind ("tracks", "albums", ...). */
export function sectionItems(browse, kind) {
  const out = [];
  for (const section of browse?.sections || []) {
    if (Array.isArray(section[kind])) out.push(...section[kind]);
  }
  return out;
}

export { assert, clone, headerEntries };
