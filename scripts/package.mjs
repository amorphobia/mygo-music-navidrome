#!/usr/bin/env node
// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build the installable MyGo Music plugin ZIP for Navidrome.
 *
 * The archive contains only what the app needs at runtime:
 *   plugin.json
 *   index.js
 *   locales/**            (every regular file under locales/)
 *
 * Development-only paths (src/, test/, scripts/, node_modules/, package.json,
 * README, LICENSE, CI files, ...) are never packaged.
 *
 * The writer is dependency-free: a small ZIP implementation on top of
 * node:zlib. Files are stored at the archive root so that the app's plugin
 * root detection finds plugin.json immediately (it also tolerates a single
 * top-level folder, but root is preferred).
 *
 * Output: dist/<id>-<version>.zip, where <id> is the manifest id:
 *   npm run package          → amorphobia-navidrome-dev-<version>.zip
 *   npm run package:release  → amorphobia-navidrome-<version>.zip
 * The dev archive changes only the packaged plugin.json's id; the repository
 * manifest and the release archive keep the published id.
 *
 * Asset name: <id>-<version>.zip
 *   The filename must not contain a platform word (darwin, linux, windows,
 *   macos, osx, win32, ...) so MyGo Music treats the asset as universal.
 *
 * Usage: node scripts/package.mjs [--release]
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
/** A local build gets its own id, so it can be installed next to the release one. */
const RELEASE = process.argv.includes("--release");
const PLATFORM_WORDS =
  /(?:^|[-_.])(darwin|linux|windows|win32|win64|macos|osx|arm64|amd64|x86_64|x64|armv[0-9]*|aarch64)(?:[-_.]|$)/i;

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* CRC-32 (IEEE 802.3), as required by the ZIP format                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* ZIP writing                                                         */
/* ------------------------------------------------------------------ */

/** Convert a JS timestamp to the DOS date/time pair used by ZIP. */
function dosDateTime(mtimeMs) {
  const date = new Date(mtimeMs);
  // The DOS format cannot represent anything before 1980.
  const year = Math.max(1980, date.getFullYear());
  const month = Math.min(12, Math.max(1, date.getMonth() + 1));
  const day = Math.min(31, Math.max(1, date.getDate()));
  const hours = Math.min(23, Math.max(0, date.getHours()));
  const minutes = Math.min(59, Math.max(0, date.getMinutes()));
  const seconds = Math.min(59, Math.max(0, date.getSeconds()));
  return {
    time: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2),
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

/**
 * Build a ZIP archive from `[{ name, data, mtimeMs }]`.
 * Uses deflate when it actually saves space, store otherwise.
 */
function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const uncompressed = file.data;
    const deflated = deflateRawSync(uncompressed, { level: 9 });
    const useDeflate = deflated.length < uncompressed.length;
    const payload = useDeflate ? deflated : uncompressed;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(uncompressed);
    const { time, date } = dosDateTime(file.mtimeMs);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract (2.0)
    local.writeUInt16LE(0x0800, 6); // general purpose flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(uncompressed.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(0x031e, 4); // version made by: Unix, 3.0
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: -rw-r--r--
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(files.length, 8); // entries on this disk
  end.writeUInt16LE(files.length, 10); // total entries
  end.writeUInt32LE(centralBuffer.length, 12); // central directory size
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 18); // comment length

  return Buffer.concat([...locals, centralBuffer, end]);
}

/* ------------------------------------------------------------------ */
/* ZIP reading and verification                                        */
/* ------------------------------------------------------------------ */

/** Read the central directory and return `[{ name, method, crc, compSize, uncompSize, localOffset }]`. */
function listZipEntries(zip) {
  const eocdOffset = (() => {
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) return i;
    }
    return -1;
  })();
  if (eocdOffset < 0) fail("The generated archive has no end-of-central-directory record.");

  const count = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      fail("The generated archive has a corrupt central directory.");
    }
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    entries.push({
      name: zip.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      method: zip.readUInt16LE(cursor + 10),
      crc: zip.readUInt32LE(cursor + 16),
      compSize: zip.readUInt32LE(cursor + 20),
      uncompSize: zip.readUInt32LE(cursor + 24),
      localOffset: zip.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Extract one entry's bytes, checking its CRC. */
function readZipEntry(zip, entry) {
  if (zip.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    fail(`Corrupt local header for ${entry.name}.`);
  }
  const nameLength = zip.readUInt16LE(entry.localOffset + 26);
  const extraLength = zip.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLength + extraLength;
  const payload = zip.subarray(dataStart, dataStart + entry.compSize);
  const data = entry.method === 0 ? Buffer.from(payload) : inflateRawSync(payload);
  if (data.length !== entry.uncompSize) {
    fail(`Size mismatch while verifying ${entry.name}.`);
  }
  if (crc32(data) !== entry.crc) {
    fail(`CRC mismatch while verifying ${entry.name}.`);
  }
  return data;
}

/** Return true when plugin.json is at the archive root (preferred) or in one top-level folder. */
function findPluginRoot(entries) {
  if (entries.some((entry) => entry.name === "plugin.json")) return ".";
  const candidates = entries
    .filter((entry) => entry.name.endsWith("/plugin.json"))
    .map((entry) => entry.name.slice(0, -"/plugin.json".length))
    .filter((dir) => dir.length > 0 && !dir.includes("/"));
  if (candidates.length === 1) return candidates[0];
  return null;
}

/* ------------------------------------------------------------------ */
/* Collecting files                                                    */
/* ------------------------------------------------------------------ */

/** Recursively collect regular files below `dir` as archive-relative paths. */
function collectFiles(dir, prefix, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(absolute, relative, out);
    } else if (entry.isFile()) {
      out.push({
        name: relative,
        data: readFileSync(absolute),
        mtimeMs: statSync(absolute).mtimeMs,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

const manifestPath = path.join(ROOT, "plugin.json");
if (!existsSync(manifestPath)) fail("plugin.json is missing from the repository root.");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`plugin.json is not valid JSON: ${error.message}`);
}

for (const field of ["id", "name", "version", "main"]) {
  if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
    fail(`plugin.json is missing the required "${field}" field.`);
  }
}

const version = manifest.version;
const mainFile = manifest.main.replace(/^\.\//, "");
const packagedId = RELEASE ? manifest.id : `${manifest.id}-dev`;
const packagedManifest = { ...manifest, id: packagedId };
const packagedManifestData = Buffer.from(`${JSON.stringify(packagedManifest, null, 2)}\n`, "utf8");
const zipName = `${packagedId}-${version}.zip`;
const zipPath = path.join(DIST_DIR, zipName);

const files = [];

// Required runtime files.
for (const name of ["plugin.json", mainFile]) {
  const absolute = path.join(ROOT, name);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    if (name === mainFile) {
      fail(
        `The bundled entry point "${mainFile}" is missing. Run "npm run build" first.`,
      );
    }
    fail(`${name} is missing from the repository root.`);
  }
  files.push({
    name,
    data: name === "plugin.json" ? packagedManifestData : readFileSync(absolute),
    mtimeMs: statSync(absolute).mtimeMs,
  });
}

// Locales are part of the distributed plugin folder.
const localesDir = path.join(ROOT, "locales");
if (!existsSync(localesDir) || !statSync(localesDir).isDirectory()) {
  fail('The "locales/" directory is missing; the plugin ships English and Simplified Chinese UI files.');
}
const localeFiles = [];
collectFiles(localesDir, "locales", localeFiles);
if (localeFiles.length === 0) {
  fail('The "locales/" directory is empty.');
}
files.push(...localeFiles);

// The asset name is what MyGo's plugin picker keys on: platform words make it
// look like a platform-specific asset, so never ship one in the universal ZIP.
if (PLATFORM_WORDS.test(zipName)) {
  fail(
    `Refusing to use the asset name "${zipName}" because it contains a platform word. ` +
      "MyGo Music treats an archive without a platform word as universal.",
  );
}

mkdirSync(DIST_DIR, { recursive: true });
const zip = createZip(files);
writeFileSync(zipPath, zip);

/* ---- Verify what was actually written ---- */

const check = readFileSync(zipPath);
const entries = listZipEntries(check);
const expected = files.map((file) => file.name).sort();
const actual = entries.map((entry) => entry.name).sort();

if (expected.join("\n") !== actual.join("\n")) {
  fail(
    `Archive contents do not match the intended file list.\n` +
      `  expected: ${expected.join(", ")}\n` +
      `  actual:   ${actual.join(", ")}`,
  );
}

const root = findPluginRoot(entries);
if (root === null) {
  fail(
    "plugin.json is not at the archive root or inside a single top-level folder, " +
      "so MyGo Music cannot find the plugin root.",
  );
}
if (root !== ".") {
  console.warn(
    `  ! plugin.json is inside the top-level folder "${root}/"; root-level files are preferred.`,
  );
}

const manifestEntry = entries.find((entry) => entry.name === `${root === "." ? "" : `${root}/`}plugin.json`);
const packagedManifestInZip = JSON.parse(readZipEntry(check, manifestEntry).toString("utf8"));
if (packagedManifestInZip.id !== packagedId || packagedManifestInZip.version !== manifest.version) {
  fail("The packaged plugin.json does not match the manifest and the build mode.");
}

const mainEntry = entries.find(
  (entry) => entry.name === `${root === "." ? "" : `${root}/`}${mainFile}`,
);
if (!mainEntry) {
  fail(`The packaged archive does not contain the declared entry point "${mainFile}".`);
}

const forbidden = entries.filter(
  (entry) =>
    /^(src|test|scripts|node_modules|\.git|dist|\.github)\//.test(entry.name) ||
    /^(package(-lock)?\.json|README(\.[^/]*)?\.md|CHANGELOG\.md|LICENSE|\.gitignore|\.gitattributes)$/.test(
      entry.name,
    ),
);
if (forbidden.length > 0) {
  fail(`Development files leaked into the archive: ${forbidden.map((entry) => entry.name).join(", ")}`);
}

// Sanity check the compression path we actually used.
for (const entry of entries) {
  if (![0, 8].includes(entry.method)) {
    fail(`Unexpected compression method ${entry.method} for ${entry.name}.`);
  }
}

/* ---- Report ---- */

const sizeKb = (zip.length / 1024).toFixed(1);
console.log(`\n  ${manifest.name} ${version} (${RELEASE ? "release" : "development"} build)`);
console.log(`  Packaged ${entries.length} files into ${path.relative(ROOT, zipPath)} (${sizeKb} KiB)`);
for (const entry of entries) {
  console.log(`    • ${entry.name}`);
}
console.log(`  Verified: plugin.json is at the plugin root (${root === "." ? "archive root" : `${root}/`}).`);
console.log(`  Verified: declared entry point ${mainFile} and ${localeFiles.length} locale file(s) are present.`);
console.log(`  Plugin id in the archive: ${packagedId}${RELEASE ? "" : " (change it back with --release)"}`);
console.log(`  Asset name: ${zipName}`);
console.log(
  "  The asset name contains no platform word, so MyGo Music treats it as a universal plugin archive.\n",
);
