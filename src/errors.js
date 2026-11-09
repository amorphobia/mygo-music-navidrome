// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// What goes wrong, in the terms MyGo Music understands.
//
// The app acts on an error's `code`: signIn asks the listener to sign in,
// setup sends them to the plugin's settings, unavailable means this can't be
// played, and unsupported means the plugin doesn't do this. Anything else
// shows its message.

/** Translate a user-facing text into the listener's language. */
export const t = (text) => (host && typeof host.t === "function" ? host.t(text) : text);

/** An error the app knows how to act on. */
export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** A problem with the plugin's settings. */
export const setupFail = (message) => fail("setup", message);

/** This track or page can't be shown. */
export const unavailableFail = (message) => fail("unavailable", message);

/** What the plugin shows when the listener hasn't filled in the server. */
export const setupMessages = {
  server: () => t("Fill in the server address in the plugin settings"),
  credentials: () => t("Fill in the username and password in the plugin settings"),
  headers: () => t('Extra headers must be a JSON object, such as {"X-Api-Key": "value"}'),
};

/** Why the server refused the request, when that's the plugin's settings. */
export const cloudflareMessage = () =>
  t('Access was denied (HTTP 403). If the server is behind Cloudflare Access, fill in the Cloudflare Access Client ID and Secret in the plugin settings, and check that the Access policy\'s action is Service Auth and that the token is allowed for this server.');

/** The server answered with a web page, such as a Cloudflare Access login. */
export const htmlMessage = () =>
  t('The server answered with a web page instead of Subsonic data. If it is behind Cloudflare Access, fill in the Cloudflare Access Client ID and Secret in the plugin settings; otherwise check the server address and reverse-proxy path.');

/** The server rejected the username or password. */
export const credentialsMessage = () =>
  t("The server rejected the username or password. Check them in the plugin settings.");

/** The server could not be reached, or took too long. */
export const networkMessage = () =>
  t("Could not reach the server. Check the address, the network and the HTTPS certificate.");

/** The address is not a Subsonic server, or the path is wrong. */
export const notSubsonicMessage = () =>
  t("This address did not return Subsonic data. Check the server address and any reverse-proxy path.");

/** A server error with no better description. */
export const serverError = (detail) => t("The server reported an error") + (detail ? `: ${detail}` : "");
