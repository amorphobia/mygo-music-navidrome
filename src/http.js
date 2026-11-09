// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
//
// The Subsonic wire: one request for each endpoint, and the errors the app
// understands when a server or something in front of it refuses.

import { apiUrl, forgetMediaAuth, readConfig, requestHeaders } from "./config.js";
import {
  cloudflareMessage,
  credentialsMessage,
  fail,
  htmlMessage,
  networkMessage,
  notSubsonicMessage,
  serverError,
  t,
} from "./errors.js";

/** A single API call may take this long before the plugin gives up. */
const TIMEOUT_MS = 25_000;

// Codes that mean the listener has to sign in again, or is being refused.
const AUTH_CODES = new Set([40, 41, 42, 43, 44, 50]);

// A refusal is the listener's to fix in the plugin's settings: MyGo Music's
// "setup" error opens them and shows what this says, while "signIn" would open
// a sign-in window that can't ask for a server address or a token.
const setupFail = (message) => fail("setup", message);

const failure = (error) => {
  const code = Number(error && error.code);
  return Number.isFinite(code) ? code : undefined;
};

/** The Subsonic error object's message, with its code for diagnosis. */
function serverFailure(error, method) {
  const code = failure(error);
  const message = error && typeof error.message === "string" ? error.message : "";
  if (code !== undefined && AUTH_CODES.has(code)) {
    forgetMediaAuth();
    return setupFail(message || credentialsMessage());
  }
  if (code === 70 && (method === "stream" || method === "getSong" || method === "download")) {
    return fail("unavailable", message || t("This track isn't available on the server"));
  }
  const detail = message || (code !== undefined ? String(code) : "");
  return new Error(serverError(detail));
}

/** Parses a Subsonic envelope, or answers null when the body isn't one. */
export function parseEnvelope(text) {
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

const looksLikeHtml = (contentType, text) => {
  if (contentType.includes("text/html")) return true;
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<");
};

/** Reads one response body, with the errors the app can act on. */
export function checkResponse(response, method) {
  const status = Number(response.status) || 0;
  const contentType = String(response.headers && typeof response.headers.get === "function" ? response.headers.get("content-type") || "" : "").toLowerCase();
  return Promise.resolve()
    .then(() => response.text())
    .then((text) => {
      const envelope = parseEnvelope(text);
      const error = envelope && envelope.error;
      if (!response.ok) {
        const code = failure(error);
        if (status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
          forgetMediaAuth();
          throw setupFail((error && error.message) || credentialsMessage());
        }
        if (status === 403) {
          forgetMediaAuth();
          throw setupFail(cloudflareMessage());
        }
        if (looksLikeHtml(contentType, text)) throw setupFail(htmlMessage());
        throw new Error(serverError(`HTTP ${status}`));
      }
      if (looksLikeHtml(contentType, text)) throw setupFail(htmlMessage());
      if (!envelope) throw new Error(notSubsonicMessage());
      if (envelope.status === "failed") throw serverFailure(envelope.error, method);
      return envelope;
    });
}

/** Runs one Subsonic API method and answers its envelope. */
export async function request(method, params = {}) {
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
        // Nothing to do; the request is finished already.
      }
    }, TIMEOUT_MS);
  }
  let response;
  try {
    response = await fetch(url, { method: "GET", headers, signal: controller ? controller.signal : undefined });
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
