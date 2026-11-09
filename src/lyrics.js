// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Lyrics, as well as the server has them: OpenSubsonic's timed lines when
// Navidrome offers them, else the older getLyrics LRC, else none.

import { requireAccount } from "./config.js";
import { unavailableFail, t } from "./errors.js";
import { getLyrics, getLyricsBySongId, getSong } from "./subsonic.js";

/** The lines of a structured-lyrics answer, if it has timed ones. */
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
      const text = String((line && line.value) || "");
      mapped.push({ start: Math.max(0, Math.round(start)), text });
    }
    if (mapped.length) return mapped;
  }
  return [];
}

/** A song's lyrics, or a clear no. */
export async function lyrics({ id }) {
  requireAccount();
  const trackId = String(id || "");
  try {
    const timed = await getLyricsBySongId({ id: trackId });
    const lines = timedLines(timed);
    if (lines.length) return { lines };
    // An unsynced answer is still words worth showing as plain LRC.
    const list = timed && timed.lyricsList && timed.lyricsList.structuredLyrics;
    const entries = Array.isArray(list) ? list : list ? [list] : [];
    for (const entry of entries) {
      const lines = Array.isArray(entry && entry.line) ? entry.line : [];
      const text = lines.map((line) => String((line && line.value) || "")).filter(Boolean);
      if (text.length) return { lrc: text.join("\n") };
    }
  } catch (error) {
    // Not every server has the OpenSubsonic lyrics extension; try the old one.
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
