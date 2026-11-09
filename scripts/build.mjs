// Bundles src/** into the single ES module MyGo Music loads: index.js.
//
// The plugin runtime resolves no imports and no Node built-ins, so the output
// must be self-contained; esbuild checks that by reporting a metafile whose
// outputs have no imports.

import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const result = await build({
  entryPoints: ["src/index.js"],
  outfile: "index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  metafile: true,
  banner: {
    js: `// Navidrome ${pkg.version} — generated from src/ by npm run build. Do not edit.\n// Copyright (c) 2026 Xuesong Peng\n// SPDX-License-Identifier: AGPL-3.0-only\n// A Navidrome / Subsonic source for MyGo Music with custom HTTP headers.\n`,
  },
});

for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.length) throw new Error("index.js must not import anything");
}

console.log("Built self-contained ESM plugin: index.js");
