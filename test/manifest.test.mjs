// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// plugin.json and locales/: what MyGo Music reads before a plugin runs.
//
// The app's own validation (internal/plugin in mygo-music) checks the id, the
// main file, minAppVersion and requestHeaders; the rest is the contract this
// plugin is written to. Everything here is static, no bundle needed.

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { ROOT, localeExists, readLocale, readManifest } from "./helpers.mjs";

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

// internal/music: NavItem.Builtin is one of these; one the source can't do
// doesn't show.
const VALID_BUILTINS = ["home", "liked", "savedAlbums", "stations", "shows"];
// internal/music: NavItem.Icon names one of the app's icons.
const VALID_ICONS = [
  "home",
  "note",
  "album",
  "artist",
  "playlist",
  "radio",
  "podcast",
  "chart",
  "calendar",
  "heart",
  "search",
  "star",
];
// The settings this plugin promises: exactly these, in this order.
const EXPECTED_SETTINGS = [
  "server",
  "username",
  "password",
  "cfAccessClientId",
  "cfAccessClientSecret",
  "authorization",
  "cookie",
  "customHeaders",
  "scrobble",
];

const manifest = readManifest();

function placeholders(text) {
  const found = [];
  for (const match of String(text).matchAll(/\{(setting|storage):([^{}]+)\}/g)) {
    found.push({ kind: match[1], key: match[2] });
  }
  return found;
}

describe("plugin.json", () => {
  test("identity: id, name, version and minAppVersion", () => {
    assert.match(manifest.id, PLUGIN_ID_PATTERN, `id ${JSON.stringify(manifest.id)} is a package-style id`);
    assert.equal(manifest.id, "amorphobia-navidrome", "the plugin id is unique, not the shared navidrome id");
    assert.equal(typeof manifest.name, "string", "name is a string");
    assert.equal(manifest.name, "Navidrome", "the displayed name is Navidrome");
    assert.ok(manifest.name.trim().length > 0, "name is not empty");
    assert.match(manifest.version, SEMVER_PATTERN, `version ${JSON.stringify(manifest.version)} is semver`);
    assert.match(manifest.minAppVersion, SEMVER_PATTERN, "minAppVersion is semver");
    assert.equal(manifest.minAppVersion, "0.1.20", "minAppVersion is the first app version with requestHeaders");
  });

  test("version in plugin.json matches package.json", () => {
    const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.equal(manifest.version, packageJson.version, "plugin.json and package.json agree on the version");
    assert.equal(manifest.main, packageJson.main, "package.json main points at the bundled module");
  });

  test("build shape: one bundled module at the root", () => {
    assert.equal(manifest.main, "index.js", "main is the root index.js");
    assert.ok(!/[/\\]/.test(manifest.main), "main is one file, not a path");
    const mainPath = path.join(ROOT, manifest.main);
    assert.ok(existsSync(mainPath), `${manifest.main} exists (run \`npm run build\`)`);
    assert.ok(statSync(mainPath).isFile(), `${manifest.main} is a file`);
    const source = readFileSync(mainPath, "utf8");
    assert.ok(source.length > 5000, "the bundle is not an empty stub");
    assert.ok(!/\bfrom\s+["']\.\//.test(source), "the bundle has no unresolved local imports");
  });

  test("playback is stream, and network permission covers the server", () => {
    assert.equal(manifest.playback, "stream", "playback is stream");
    assert.ok(manifest.permissions && typeof manifest.permissions === "object", "permissions is an object");
    assert.ok(Array.isArray(manifest.permissions.network), "permissions.network is a list");
    assert.ok(manifest.permissions.network.includes("*"), 'permissions.network includes "*"');
    assert.ok(!manifest.permissions.process, "the plugin starts no programs");
  });

  test("requestHeaders carry the Cloudflare Access service token to covers and audio", () => {
    assert.ok(Array.isArray(manifest.requestHeaders), "requestHeaders is a list");
    assert.ok(manifest.requestHeaders.length >= 1, "there is a requestHeaders rule");

    const rule = manifest.requestHeaders.find(
      (entry) => Array.isArray(entry.kinds) && entry.kinds.includes("image") && entry.kinds.includes("audio"),
    );
    assert.ok(rule, "a rule applies to both image and audio");
    assert.deepEqual(rule.hosts, ["{setting:server}"], "the rule is for the server setting's host");
    assert.ok(!("hosts" in rule && rule.hosts.includes("*")), "hosts never name every host");

    const expectedHeaders = {
      "CF-Access-Client-Id": "{setting:cfAccessClientId}",
      "CF-Access-Client-Secret": "{setting:cfAccessClientSecret}",
      Authorization: "{setting:authorization}",
      Cookie: "{setting:cookie}",
    };
    const names = Object.keys(rule.headers || {});
    for (const [name, value] of Object.entries(expectedHeaders)) {
      assert.ok(names.includes(name), `the rule has the ${name} header`);
      assert.equal(rule.headers[name], value, `${name} comes from its setting`);
      for (const used of placeholders(rule.headers[name])) {
        assert.equal(used.kind, "setting", `${name} uses a setting placeholder`);
        assert.ok(
          manifest.settings.some((setting) => setting.key === used.key),
          `${name} names an existing setting: ${used.key}`,
        );
      }
    }

    for (const entry of manifest.requestHeaders) {
      assert.ok(Array.isArray(entry.hosts) && entry.hosts.length > 0, "each rule names its hosts");
      assert.ok(entry.headers && Object.keys(entry.headers).length > 0, "each rule names its headers");
      for (const kind of entry.kinds || []) {
        assert.ok(["image", "audio"].includes(kind), `kind ${JSON.stringify(kind)} is image or audio`);
      }
      for (const name of Object.keys(entry.headers || {})) {
        assert.ok(!/^(host|content-length)$/i.test(name), `header ${JSON.stringify(name)} isn't one the app forbids`);
        assert.ok(!/^fetch-$/i.test(name), "no header name trips fetch");
        for (const used of placeholders(entry.headers[name])) {
          assert.equal(typeof used.key, "string", "placeholder has a key");
          if (used.kind === "setting") {
            assert.ok(
              manifest.settings.some((setting) => setting.key === used.key),
              `placeholder names an existing setting: ${used.key}`,
            );
          }
        }
      }
      for (const host of entry.hosts) {
        const used = placeholders(host)[0];
        if (used) {
          assert.equal(used.kind, "setting", "host placeholders are settings");
          assert.ok(
            manifest.settings.some((setting) => setting.key === used.key),
            `host placeholder names an existing setting: ${used.key}`,
          );
        }
      }
    }
  });

  test("settings are unique and exactly the documented keys", () => {
    assert.ok(Array.isArray(manifest.settings), "settings is a list");
    const keys = manifest.settings.map((setting) => setting.key);
    assert.deepEqual(
      keys,
      EXPECTED_SETTINGS,
      "settings are exactly server, username, password, the Cloudflare pair, authorization, cookie, customHeaders and scrobble",
    );
    assert.equal(new Set(keys).size, keys.length, "setting keys are unique");
    for (const setting of manifest.settings) {
      assert.match(setting.key, SETTING_KEY_PATTERN, `setting key ${JSON.stringify(setting.key)} is identifier-like`);
      assert.equal(typeof setting.label, "string", `${setting.key} has a label`);
      assert.ok(setting.label.trim().length > 0, `${setting.key}'s label is not empty`);
      if (setting.help !== undefined) {
        assert.equal(typeof setting.help, "string", `${setting.key}'s help is a string`);
        assert.ok(setting.help.trim().length > 0, `${setting.key}'s help is not empty`);
      }
    }
    const server = manifest.settings.find((setting) => setting.key === "server");
    assert.equal(server.label, "Server address", "the server setting's label says what it is");
    assert.ok(server.help, "the server setting explains itself");
    assert.match(server.help, /address|server/i, "the server help says what the setting is");
    assert.match(server.help, /cover|audio/i, "the server help says what its host is used for");

    const customHeaders = manifest.settings.find((setting) => setting.key === "customHeaders");
    assert.match(customHeaders.label, /json/i, "the customHeaders label says it is JSON");
  });

  test("navigation uses the app's built-in pages and valid icons", () => {
    assert.ok(Array.isArray(manifest.navigation), "navigation is a list");
    assert.ok(manifest.navigation.length >= 4, "navigation lists the plugin's pages");
    const seen = new Set();
    for (const item of manifest.navigation) {
      if (item.builtin !== undefined) {
        assert.ok(VALID_BUILTINS.includes(item.builtin), `builtin ${JSON.stringify(item.builtin)} is one the app has`);
        assert.equal(item.title, undefined, `the builtin ${item.builtin} page has no title of the plugin's`);
        assert.equal(item.page, undefined, `the builtin ${item.builtin} page has no page id of the plugin's`);
      } else {
        assert.equal(typeof item.title, "string", "a navigation page has a title");
        assert.ok(item.title.trim().length > 0, "a navigation page's title is not empty");
        assert.equal(typeof item.page, "string", `navigation title ${JSON.stringify(item.title)} has a page id`);
        assert.match(item.page, /^[a-z][a-z0-9-]*$/, `page id ${JSON.stringify(item.page)} is a browse id`);
        assert.ok(!seen.has(item.page), `page id ${JSON.stringify(item.page)} is used once`);
        seen.add(item.page);
        if (item.icon !== undefined) {
          assert.ok(VALID_ICONS.includes(item.icon), `icon ${JSON.stringify(item.icon)} is one the app has`);
        }
      }
    }
    assert.ok(
      manifest.navigation.some((item) => item.builtin === "home"),
      "navigation has the home page",
    );
    const songs = manifest.navigation.find((item) => item.page === "songs");
    assert.ok(songs, "navigation has the Songs page");
    assert.equal(songs.title, "Songs", "the Songs page is titled");
    assert.equal(songs.icon, "note", "the Songs page uses the note icon");
    assert.equal(manifest.navigation[1], songs, "Songs comes right after Home in the sidebar");
  });
});

describe("locales/zh-CN.json", () => {
  test("is a flat JSON map of English to Simplified Chinese", () => {
    assert.ok(localeExists("zh-CN"), "locales/zh-CN.json exists");
    const locale = readLocale("zh-CN");
    assert.equal(typeof locale, "object", "the locale is a JSON object");
    assert.ok(!Array.isArray(locale), "the locale maps texts, not a list");
    const entries = Object.entries(locale);
    assert.ok(entries.length > 0, "the locale has translations");
    for (const [source, translated] of entries) {
      assert.equal(typeof source, "string", "every key is English text");
      assert.ok(source.length > 0, "no empty keys");
      assert.equal(typeof translated, "string", `the translation of ${JSON.stringify(source)} is a string`);
      assert.ok(translated.trim().length > 0, `the translation of ${JSON.stringify(source)} is not empty`);
    }
  });

  test("translates the plugin name, every setting label and help, and navigation titles", () => {
    const locale = readLocale("zh-CN");
    const need = (text, what) => {
      assert.equal(typeof locale[text], "string", `${what} is translated: ${JSON.stringify(text)}`);
      assert.ok(locale[text].trim().length > 0, `${what} has a non-empty translation: ${JSON.stringify(text)}`);
    };

    need(manifest.name, "the plugin name");
    for (const setting of manifest.settings) {
      need(setting.label, `setting ${setting.key}'s label`);
      if (setting.help) need(setting.help, `setting ${setting.key}'s help`);
    }
    for (const item of manifest.navigation) {
      if (item.title) need(item.title, `navigation title for page ${item.page}`);
    }

    // A locale that only echoes English is not a translation for the UI texts.
    const changed = Object.entries(locale).filter(([source, translated]) => source !== translated);
    assert.ok(changed.length >= 3, `the locale translates the UI, not only copies English (${changed.length} changed)`);

    // The Songs page's own texts, which aren't in plugin.json but are displayed.
    for (const text of ["Songs", "All songs", "No songs in the library", "Previous page", "Next page"]) {
      need(text, `the Songs page text ${JSON.stringify(text)}`);
    }
  });

  test("only the languages the app speaks", () => {
    const dir = path.join(ROOT, "locales");
    assert.ok(existsSync(dir), "locales/ exists");
    for (const file of ["en", "zh-CN"]) {
      if (file === "en") continue;
      assert.ok(localeExists(file), `locales/${file}.json exists`);
    }
    // English is the key language, so an en.json is meaningless.
    assert.ok(!localeExists("en"), "there is no locales/en.json: English is the source text");
  });
});
