// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
//
// Playing audio: the app plays what stream() answers, fetching the URL itself,
// so the URL carries the Subsonic token and the headers carry whatever the
// server sits behind (such as a Cloudflare Access service token).

import { mediaApiUrl, requestHeaders, requireAccount } from "./config.js";
import { unavailableFail, t } from "./errors.js";
import { getSong } from "./subsonic.js";

// The formats MyGo Music's player decodes, by file suffix. "ogg" is only
// Vorbis: Opus and FLAC in Ogg have to be transcoded.
const suffixFormats = new Map([
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
  ["aac", { type: "aac", lossless: false }],
]);

// Formats the app can't decode at all: they're transcoded to MP3.
const unsupported = new Set(["ape", "wv", "wma", "aiff", "aif", "mp1", "mp2", "opus", "dsf", "dff"]);

const mimeFormats = new Map([
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
  ["audio/x-aac", { type: "aac", lossless: false }],
]);

const codecOf = (contentType) => {
  const found = /\bcodecs\s*=\s*"?([^";]+)/i.exec(String(contentType || ""));
  return found ? found[1].trim().toLowerCase() : "";
};

/** The source format of a song, or null when the app can't play it raw. */
export function sourceFormat(song) {
  const suffix = String((song && song.suffix) || "").trim().toLowerCase();
  const contentType = String((song && song.contentType) || "").toLowerCase();
  const codec = codecOf(contentType);
  const mime = contentType.split(";")[0].trim();

  if (unsupported.has(suffix)) return null;
  // Ogg is only decodable as Vorbis; Opus, FLAC and Speex have to transcode.
  if ((suffix === "ogg" || suffix === "oga" || mime === "audio/ogg" || mime === "application/ogg") && codec) {
    if (codec !== "vorbis") return null;
  }
  if (suffix && suffixFormats.has(suffix)) {
    const format = suffixFormats.get(suffix);
    // An MP4 that says codecs=…: only ALAC, FLAC and AAC-LC are decodable.
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

/** Audio for a track, of the quality the listener asked for. */
export async function stream({ id, quality = "high" }) {
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
    // The original file, as long as the player decodes that format. "raw" asks
    // the server not to transcode it.
    type = format.type;
    params.format = "raw";
  } else {
    // MP3 at 320 kbps for high, 128 for standard; also the fallback for a
    // format the player can't decode, such as APE or Opus.
    params.format = "mp3";
    params.maxBitRate = quality === "standard" ? 128 : 320;
    type = "mp3";
  }
  return {
    url: mediaApiUrl("stream", params, config),
    type,
    headers: requestHeaders(config, { json: false }),
  };
}
