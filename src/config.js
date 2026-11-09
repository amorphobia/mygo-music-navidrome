// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// The plugin's settings, the Subsonic address they make, and the headers every
// request carries.
//
// Custom HTTP headers are why this plugin exists. MyGo Music fetches a
// plugin's pictures and audio itself, so headers those requests need must also
// be declared in plugin.json's "requestHeaders", which only takes header
// names written there. The fixed fields (Cloudflare Access service token,
// Authorization, Cookie) therefore cover the app's own fetches, while the
// JSON "Extra headers" field adds any other header to the plugin's API calls
// and to the audio URL it hands the app.

import { fail, setupFail, setupMessages, t } from "./errors.js";

/** The Subsonic client name the plugin sends. */
export const CLIENT = "mygo-music-navidrome";
/** The Subsonic API version the plugin speaks. */
export const API_VERSION = "1.16.1";

const setting = (key) => {
  const value = host.setting(key);
  return typeof value === "string" ? value : value == null ? "" : String(value);
};

/** Reads the settings as the listener has them now. */
export function readConfig() {
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
    scrobble: setting("scrobble").trim(),
  };
}

/** Whether the listener wants plays saved to the server's history. */
export function scrobbleEnabled(config = readConfig()) {
  return /^(1|true|yes|on)$/i.test(config.scrobble);
}

/** The server's base URL, without the trailing slashes the setting may carry. */
export function baseUrl(config = readConfig()) {
  let server = config.server;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(server)) {
    // A bare host, such as music.example.com or 192.168.1.10:4533, is HTTPS.
    server = `https://${server}`;
  }
  server = server.replace(/\/+$/, "");
  return server;
}

/** Throws a setup error unless the server is set. */
export function requireServer() {
  const config = readConfig();
  if (!config.server) throw setupFail(setupMessages.server());
  return config;
}

/** Throws a setup error unless the server and account are set. */
export function requireAccount() {
  const config = requireServer();
  if (!config.username || !config.password) throw setupFail(setupMessages.credentials());
  return config;
}

/** Where the server's Subsonic API lives, with a subpath if the setting has one. */
export function apiUrl(method, params = {}, config = readConfig(), auth = authParams(config)) {
  const url = new URL(`${baseUrl(config)}/rest/${method}`);
  addParams(url, auth);
  addParams(url, { v: API_VERSION, c: CLIENT, f: "json" });
  addParams(url, params);
  return url.toString();
}

/** Adds parameters, repeated for arrays and skipped when empty. */
export function addParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

/** A random salt for a signed request; the server only needs it to be new. */
export function newSalt() {
  const words = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${words}${Math.random().toString(36).slice(2)}`.slice(0, 20).padEnd(8, "0");
}

/** The Subsonic sign-in parameters: a token, never the password itself. */
export function authParams(config = readConfig(), salt = newSalt()) {
  return {
    u: config.username,
    t: host.crypto.md5(config.password + salt),
    s: salt,
  };
}

// One token for the session's pictures and audio. The app caches covers by
// their URL, so a fresh salt per page would make every cover a new picture to
// fetch; the same salt keeps the URL, and with it the cache entry.
let mediaAuth = null; // { key, auth }

/** The Subsonic token cover and stream URLs carry, stable for the session. */
export function mediaAuthParams(config = readConfig()) {
  const key = configKey(config);
  if (!mediaAuth || mediaAuth.key !== key) {
    mediaAuth = { key, auth: authParams(config) };
  }
  return mediaAuth.auth;
}

/** Forgets the media token, so the next media URL is signed anew. */
export function forgetMediaAuth() {
  mediaAuth = null;
}

/** A URL the app fetches itself: a cover, or a song's audio. */
export function mediaApiUrl(method, params = {}, config = readConfig()) {
  return apiUrl(method, params, config, mediaAuthParams(config));
}

/**
 * The headers the plugin's own fetch calls carry: the app's fixed header
 * fields and any extra headers, or only the extra headers when the request is
 * media the plugin hands over rather than API JSON.
 */
export function requestHeaders(config = readConfig(), { json = true } = {}) {
  const headers = {};
  if (json) headers.Accept = "application/json";
  if (config.cfAccessClientId) headers["CF-Access-Client-Id"] = config.cfAccessClientId;
  if (config.cfAccessClientSecret) headers["CF-Access-Client-Secret"] = config.cfAccessClientSecret;
  if (config.authorization) headers.Authorization = config.authorization;
  if (config.cookie) headers.Cookie = config.cookie;
  Object.assign(headers, extraHeaders(config));
  return headers;
}

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** The listener's "Extra headers (JSON)" field, parsed. */
export function extraHeaders(config = readConfig()) {
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
    // The runtime sets these itself; anything else is the listener's to set.
    if (lower === "host" || lower === "content-length" || lower === "connection") continue;
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const text = String(value);
    if (/[\r\n]/.test(text)) continue;
    headers[name] = text;
  }
  return headers;
}

/** Identifies the server and credentials a cached answer belongs to. */
export function configKey(config = readConfig()) {
  return [
    baseUrl(config),
    config.username,
    host.crypto.md5(config.password),
    config.cfAccessClientId,
    config.cfAccessClientSecret,
    config.authorization,
    config.cookie,
    config.customHeaders,
  ].join("\u0000");
}
