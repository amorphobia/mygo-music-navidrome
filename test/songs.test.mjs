// SPDX-License-Identifier: AGPL-3.0-only
// The Songs page: Navidrome's native API for title order, Subsonic as fallback.
//
// Navidrome's Subsonic API can't sort the whole library, but its own REST API
// can (/api/song?_sort=title&_order=ASC). Whether the server is Navidrome is
// decided once per sign-in (account() warms it, signIn() awaits it; the Songs
// page detects lazily if nobody did), and the answer — a token or "not
// Navidrome" — lasts for the session until setSetting/signOut.
//
// The app's Browse pages have no paging buttons, so a page of songs offers the
// neighbouring pages as section links ("Previous page"/"Next page").

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  apiRequests,
  assertAuth,
  bundleSkip,
  errorCode,
  loadPlugin,
  makeDb,
  makeRoutes,
  settle,
  throwsAsync,
} from "./helpers.mjs";

const CREDENTIALS = { username: "alice", password: "s3cret" };
const PAGE = 100;

/** A song as Navidrome's native /api/song returns it. */
function nativeSong(overrides = {}) {
  return {
    id: "native-1",
    title: "Native Song",
    album: "Native Album",
    albumId: "abc123",
    artist: "Flat Artist",
    artistId: "flat-artist",
    albumArtist: "Flat Album Artist",
    albumArtistId: "flat-album-artist",
    duration: 245.6,
    year: 2024,
    participants: {
      artist: [{ id: "artist-1", name: "Native Artist" }],
      albumartist: [{ id: "artist-1", name: "Native Album Artist" }],
    },
    ...overrides,
  };
}

/** `count` native songs, titled so a title-ascending page reads in order. */
function nativeSongs(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) =>
    nativeSong({
      id: `native-${index}`,
      title: `Song ${String(index).padStart(3, "0")}`,
      albumId: `album-${index}`,
      ...overrides,
    }),
  );
}

/** A Subsonic song shaped song, for a big fallback library. */
function subsonicSongs(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `sub-${index}`,
    title: `Subsong ${String(index).padStart(3, "0")}`,
    album: "Sub Album",
    albumId: "album-1",
    artist: "Artist",
    artistId: "artist-1",
    duration: 200,
    suffix: "mp3",
    contentType: "audio/mpeg",
  }));
}

/**
 * A fake Navidrome with its native API on top of the sample Subsonic server.
 *
 * options:
 *  - probeStatus: what GET /api/song (the detection probe) answers (default 401)
 *  - probe(req, state): replaces the probe answer
 *  - login(req, state): replaces the login answer (default 200 {token})
 *  - songs(req, state): answers the native song page (default: empty)
 *  - tokens: the tokens successive logins mint
 *  - db: the Subsonic sample database behind the fallback
 */
function fakeNavidrome(options = {}) {
  const db = options.db || makeDb();
  const subsonic = makeRoutes(db);
  const state = {
    probes: [],
    logins: [],
    songs: [],
    tokens: [...(options.tokens || ["token-1"])],
    minted: 0,
  };

  const route = async (req) => {
    if (req.pathname.endsWith("/api/song")) {
      // The native page asks for a title sort: that's a song request, not the
      // detection probe.
      if (req.params._sort !== undefined) {
        state.songs.push(req);
        if (options.songs) return options.songs(req, state);
        return { json: [], headers: { "x-total-count": "0" } };
      }
      state.probes.push(req);
      if (options.probe) return options.probe(req, state);
      return { status: options.probeStatus ?? 401 };
    }
    if (req.pathname.endsWith("/auth/login")) {
      state.logins.push(req);
      if (options.login) return options.login(req, state);
      const token = state.tokens[Math.min(state.minted, state.tokens.length - 1)];
      state.minted += 1;
      return { status: 200, json: { token } };
    }
    return subsonic(req);
  };

  return { db, route, state };
}

/** A fake whose native pages come from a fixed list, sliced by the request. */
function fakeWithLibrary(songs, extra = {}) {
  return fakeNavidrome({
    ...extra,
    songs: (req) => {
      const start = Number(req.params._start);
      const end = Number(req.params._end);
      return { json: songs.slice(start, end), headers: { "x-total-count": String(songs.length) } };
    },
  });
}

function songsPage(page) {
  return page.sections[0];
}

function linksOf(page) {
  return songsPage(page).links || [];
}

function bearerOf(req) {
  return String(req.header("x-nd-authorization") || "");
}

describe("native detection at sign-in", { skip: bundleSkip() }, () => {
  test('account() warms the detection once; the Songs page does not probe again', async () => {
    const fake = fakeWithLibrary(nativeSongs(3));
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });

    const account = plugin.account();
    assert.equal(account instanceof Promise, false, "account() answers at once");
    assert.deepEqual(account, { id: "alice", name: "alice" }, "the configured account");
    assert.equal(apiRequests(requests, "ping").length, 0, "account() doesn't ping the Subsonic API");

    await settle();
    assert.equal(fake.state.probes.length, 1, "the native route was probed in the background");
    assert.equal(fake.state.logins.length, 1, "and the plugin signed in natively");

    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 3, "the Songs page uses the warmed session");
    assert.equal(fake.state.probes.length, 1, "the Songs page didn't probe again");
    assert.equal(fake.state.logins.length, 1, "and didn't sign in again");
    assert.equal(fake.state.songs.length, 1, "it asked for the song page only");
    assert.equal(apiRequests(requests, "search3").length, 0, "no Subsonic fallback was needed");
  });

  test("signIn() warms the detection while it pings", async () => {
    const fake = fakeWithLibrary(nativeSongs(2));
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });

    const account = await plugin.signIn();
    assert.deepEqual(account, { id: "alice", name: "alice" }, "signIn answers the account");
    assert.equal(apiRequests(requests, "ping").length, 1, "it pinged the Subsonic API");

    assert.equal(fake.state.probes.length, 1, "the native route was probed");
    assert.equal(fake.state.logins.length, 1, "and signed in natively");
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 2, "the warmed session answers the Songs page");
    assert.equal(fake.state.probes.length, 1, "with no second probe");
    assert.equal(fake.state.logins.length, 1, "and no second login");
  });

  test("the Songs page still detects lazily when nobody warmed it", async () => {
    const fake = fakeWithLibrary(nativeSongs(2));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    assert.equal(fake.state.probes.length, 0, "nothing asked yet");
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 2, "the page answered");
    assert.equal(fake.state.probes.length, 1, "the page probed once");
    assert.equal(fake.state.logins.length, 1, "and signed in once");
    await plugin.browse({ page: "songs:100" });
    assert.equal(fake.state.probes.length, 1, "the next page reuses the session");
  });

  test("signIn() after account()'s warm-up doesn't probe or sign in again", async () => {
    const fake = fakeWithLibrary(nativeSongs(2));
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    plugin.account();
    await settle();
    assert.equal(fake.state.probes.length, 1, "the warm-up decided");
    assert.equal(fake.state.logins.length, 1, "and signed in");

    await plugin.signIn();
    assert.equal(apiRequests(requests, "ping").length, 1, "signIn still pings the Subsonic API");
    assert.equal(fake.state.probes.length, 1, "but doesn't probe the native route again");
    assert.equal(fake.state.logins.length, 1, "and doesn't sign in again");
  });

  test("a page opened while the warm-up is in flight shares it", async () => {
    const fake = fakeWithLibrary(nativeSongs(3));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    plugin.account();
    // No settle: the Songs page races the background detection.
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 3, "the page answered");
    assert.equal(fake.state.probes.length, 1, "only one probe happened");
    assert.equal(fake.state.logins.length, 1, "and one native sign-in");
  });

  test("a 'not Navidrome' answer lasts the whole session, until the settings change", async () => {
    const fake = fakeNavidrome({ probeStatus: 404 });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });

    plugin.account();
    await settle();
    assert.equal(fake.state.probes.length, 1, "account() probed once");
    assert.equal(fake.state.logins.length, 0, "a server that isn't Navidrome isn't asked to log in");

    await plugin.browse({ page: "songs" });
    await plugin.browse({ page: "songs:100" });
    assert.equal(fake.state.probes.length, 1, "the Songs pages don't ask again in this session");

    plugin.setSetting({ key: "customHeaders", value: "" });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.probes.length, 2, "a setting change forgets the answer, so it is decided again");
  });

  test("setSetting and signOut forget the native token", async () => {
    const fake = fakeWithLibrary(nativeSongs(1));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.logins.length, 1, "signed in the first time");

    plugin.setSetting({ key: "customHeaders", value: "" });
    await settle();
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.logins.length, 2, "a setting change signs in again");

    plugin.signOut();
    await settle();
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.logins.length, 3, "signing out signs in again");
  });
});

describe("Songs page on Navidrome's native API", { skip: bundleSkip() }, () => {
  test("the native page is title-sorted, one page of 100, with the token", async () => {
    const fake = fakeWithLibrary(nativeSongs(3));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });

    assert.equal(page.title, "Songs", "the page is titled");
    assert.equal(page.sections.length, 1, "one section");
    assert.equal(songsPage(page).title, "All songs", "it lists every song");
    assert.equal(songsPage(page).tracks.length, 3, "the native songs are the tracks");
    assert.equal(songsPage(page).morePage, undefined, "paging uses links now, not See All");
    assert.deepEqual(linksOf(page), [], "three of three songs means no paging links");

    assert.equal(fake.state.probes.length, 1, "the server was probed once");
    const probe = fake.state.probes[0];
    assert.equal(probe.httpMethod, "GET", "the probe is a GET");
    assert.equal(probe.pathname, "/api/song", "at the native song route");
    assert.equal(probe.params._start, "0", "asking for the first row");
    assert.equal(probe.params._end, "1", "one row");
    assert.equal(probe.header("x-nd-authorization"), null, "the probe carries no token");

    assert.equal(fake.state.logins.length, 1, "one sign-in");
    const login = fake.state.logins[0];
    assert.equal(login.httpMethod, "POST", "the login is a POST");
    assert.equal(login.pathname, "/auth/login", "at Navidrome's login route");
    assert.match(login.header("content-type") || "", /application\/json/i, "it sends JSON");
    assert.deepEqual(JSON.parse(login.body), { username: "alice", password: "s3cret" }, "with the account");

    assert.equal(fake.state.songs.length, 1, "one native song page");
    const songs = fake.state.songs[0];
    assert.equal(songs.pathname, "/api/song", "the native song route");
    assert.equal(songs.params._sort, "title", "sorted by title");
    assert.equal(songs.params._order, "ASC", "ascending");
    assert.equal(songs.params._start, "0", "from the top");
    assert.equal(songs.params._end, String(PAGE), "a page of 100 songs");
    assert.equal(bearerOf(songs), "Bearer token-1", "with the token the login minted");
  });

  test("the token is reused: one probe and one login serve several pages", async () => {
    const fake = fakeWithLibrary(nativeSongs(250));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });

    await plugin.browse({ page: "songs" });
    await plugin.browse({ page: "songs:100" });
    assert.equal(fake.state.probes.length, 1, "the server was probed only once");
    assert.equal(fake.state.logins.length, 1, "and signed in only once");
    assert.equal(fake.state.songs.length, 2, "two pages were asked for");
    assert.deepEqual(
      fake.state.songs.map((req) => [req.params._start, req.params._end]),
      [
        ["0", "100"],
        ["100", "200"],
      ],
      "each page asks for its own range",
    );
    assert.equal(bearerOf(fake.state.songs[1]), "Bearer token-1", "the same token served the second page");
  });

  test("the server's subpath is kept in the native URLs", async () => {
    const fake = fakeWithLibrary(nativeSongs(1));
    const { plugin } = await loadPlugin({
      settings: { server: "https://example.com/navidrome/" },
      db: fake.db,
      route: fake.route,
    });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.probes[0].pathname, "/navidrome/api/song", "the probe keeps the subpath");
    assert.equal(fake.state.logins[0].pathname, "/navidrome/auth/login", "so does the login");
    assert.equal(fake.state.songs[0].pathname, "/navidrome/api/song", "and the song page");
  });

  test("concurrent pages share one detection and one sign-in", async () => {
    const fake = fakeWithLibrary(nativeSongs(200));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const [first, second] = await Promise.all([
      plugin.browse({ page: "songs" }),
      plugin.browse({ page: "songs:100" }),
    ]);
    assert.equal(songsPage(first).tracks.length, 100, "the first page answered");
    assert.equal(songsPage(second).tracks.length, 100, "the second page answered");
    assert.equal(fake.state.probes.length, 1, "one probe shared by both");
    assert.equal(fake.state.logins.length, 1, "one login shared by both");
    assert.equal(fake.state.songs.length, 2, "both pages were fetched");
  });
});

describe("native session repair", { skip: bundleSkip() }, () => {
  test("a 401 on the song page signs in again once, then retries", async () => {
    let calls = 0;
    const fake = fakeNavidrome({
      tokens: ["token-1", "token-2"],
      songs: () => {
        calls += 1;
        if (calls === 1) return { status: 401 };
        return { json: nativeSongs(2), headers: { "x-total-count": "2" } };
      },
    });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 2, "the retry answered the page");
    assert.equal(fake.state.probes.length, 2, "the server was probed again after the 401");
    assert.equal(fake.state.logins.length, 2, "and signed in again");
    assert.equal(bearerOf(fake.state.songs[0]), "Bearer token-1", "the first try used the old token");
    assert.equal(bearerOf(fake.state.songs[1]), "Bearer token-2", "the retry used the new one");
  });

  test("a second 401 after re-login falls back, without a retry loop", async () => {
    const fake = fakeNavidrome({
      tokens: ["token-1", "token-2"],
      songs: () => ({ status: 401 }),
    });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(fake.state.songs.length, 2, "the song page was tried once and once after re-login");
    assert.equal(fake.state.logins.length, 2, "one re-login, no more");
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic answered instead");
    assert.equal(apiRequests(requests, "search3").length, 1);
  });

  test("a failed re-login after a 401 falls back to Subsonic", async () => {
    let logins = 0;
    let songCalls = 0;
    const fake = fakeNavidrome({
      login: () => {
        logins += 1;
        return logins === 1 ? { status: 200, json: { token: "token-1" } } : { status: 401 };
      },
      songs: () => {
        songCalls += 1;
        return { status: 401 };
      },
    });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.ok(songsPage(page).tracks.length > 0, "the Subsonic fallback still shows the library");
    assert.equal(songCalls, 1, "the song page wasn't retried because the new sign-in failed");
    assert.equal(fake.state.logins.length, 2, "the one re-login was attempted");
    assert.ok(apiRequests(requests, "search3").length >= 1, "and Subsonic search answered");
  });

  test("x-nd-authorization on the song answer refreshes the token", async () => {
    const all = nativeSongs(250);
    const fake = fakeNavidrome({
      songs: (req) => {
        const start = Number(req.params._start);
        const end = Number(req.params._end);
        const headers = { "x-total-count": "250" };
        if (start === 0) headers["x-nd-authorization"] = "Bearer refreshed-token";
        return { json: all.slice(start, end), headers };
      },
    });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    await plugin.browse({ page: "songs" });
    await plugin.browse({ page: "songs:100" });
    assert.equal(bearerOf(fake.state.songs[1]), "Bearer refreshed-token", "the refreshed token is used next");
    assert.equal(fake.state.logins.length, 1, "and no new login was needed");
  });

  test("a refresh header without the Bearer prefix is still used", async () => {
    const all = nativeSongs(250);
    const fake = fakeNavidrome({
      songs: (req) => {
        const start = Number(req.params._start);
        const end = Number(req.params._end);
        const headers = { "x-total-count": "250" };
        if (start === 0) headers["x-nd-authorization"] = "plain-token";
        return { json: all.slice(start, end), headers };
      },
    });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    await plugin.browse({ page: "songs" });
    await plugin.browse({ page: "songs:100" });
    assert.equal(bearerOf(fake.state.songs[1]), "Bearer plain-token", "the bare token is carried as a bearer token");
    assert.equal(fake.state.logins.length, 1, "no new login needed");
  });
});

describe("Songs pagination links", { skip: bundleSkip() }, () => {
  test("the first page links only to the next one", async () => {
    const fake = fakeWithLibrary(nativeSongs(250));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 100, "a full first page");
    assert.deepEqual(linksOf(page), [{ title: "Next page", page: "songs:100" }], "only Next on the first page");
    assert.equal(songsPage(page).morePage, undefined, "no See All link");
  });

  test("a middle page links to both, in order", async () => {
    const fake = fakeWithLibrary(nativeSongs(250));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs:100" });
    assert.equal(songsPage(page).tracks.length, 100, "a full middle page");
    assert.deepEqual(
      linksOf(page),
      [
        { title: "Previous page", page: "songs:0" },
        { title: "Next page", page: "songs:200" },
      ],
      "Previous then Next in the middle",
    );
    assert.equal(songsPage(page).morePage, undefined, "no See All link");
  });

  test("the last page links only to the previous one", async () => {
    const fake = fakeWithLibrary(nativeSongs(250));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs:200" });
    assert.equal(songsPage(page).tracks.length, 50, "the last page has the rest");
    assert.deepEqual(linksOf(page), [{ title: "Previous page", page: "songs:100" }], "only Previous on the last page");
    assert.equal(songsPage(page).morePage, undefined, "no See All link");
  });

  test("a short page with no total has no links at all", async () => {
    const fake = fakeNavidrome({ songs: () => ({ json: nativeSongs(5) }) });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 5);
    assert.deepEqual(linksOf(page), [], "no Previous on the first page, no Next on a short page");
    assert.equal(songsPage(page).empty, undefined, "a non-empty page doesn't say the library is empty");
  });

  test("a full page with no total links to the next one", async () => {
    const fake = fakeNavidrome({ songs: () => ({ json: nativeSongs(100) }) });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.deepEqual(linksOf(page), [{ title: "Next page", page: "songs:100" }], "a full page suggests the next");
  });

  test("a header that isn't a number counts as unknown", async () => {
    const fake = fakeNavidrome({
      songs: () => ({ json: nativeSongs(100), headers: { "x-total-count": "many" } }),
    });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.deepEqual(linksOf(page), [{ title: "Next page", page: "songs:100" }], "the full-page rule applies");
  });

  test('browse("songs:0") is the first page', async () => {
    const fake = fakeWithLibrary(nativeSongs(2));
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs:0" });
    assert.equal(songsPage(page).title, "All songs");
    assert.equal(songsPage(page).tracks.length, 2);
    assert.equal(fake.state.songs[0].params._start, "0", "offset 0 is the first page");
    assert.deepEqual(linksOf(page), [], "and it has no Previous");
  });

  test("an empty native library says so, with no links", async () => {
    const fake = fakeNavidrome({ songs: () => ({ json: [], headers: { "x-total-count": "0" } }) });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 0, "no songs");
    assert.deepEqual(linksOf(page), [], "no paging");
    assert.equal(songsPage(page).empty, "No songs in the library", "the section says the library is empty");
    assert.equal(apiRequests(requests, "search3").length, 0, "the native answer was enough: no Subsonic fallback");
  });
});

describe("Subsonic fallback without the native API", { skip: bundleSkip() }, () => {
  test("a 404 probe falls back to Subsonic search in natural order", async () => {
    const fake = fakeNavidrome({ probeStatus: 404 });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(page.title, "Songs");
    assert.equal(songsPage(page).title, "All songs");
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic returned the whole library");
    assert.equal(fake.state.logins.length, 0, "a server that isn't Navidrome isn't asked to log in");

    const search = requests.filter((req) => req.apiMethod === "search3");
    assert.equal(search.length, 1, "one Subsonic search");
    assert.equal(search[0].params.query, undefined, "an empty query sends no query parameter");
    assert.equal(search[0].params.songCount, "100", "a page of 100 songs");
    assert.equal(search[0].params.songOffset, "0", "from the top");
    assert.equal(songsPage(page).tracks[0].id, "song-1", "natural order is kept");
    assert.deepEqual(linksOf(page), [], "only eight songs: no pages");
  });

  test("a 200 probe means some other API, and the fallback is used", async () => {
    const fake = fakeNavidrome({ probe: () => ({ status: 200, json: [] }) });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic answered");
    assert.equal(fake.state.logins.length, 0, "no login at a route that isn't Navidrome's");
    assert.equal(apiRequests(requests, "search3").length, 1);
  });

  test("a failing login falls back, and the answer is cached for the session", async () => {
    const fake = fakeNavidrome({ login: () => ({ status: 401 }) });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.logins.length, 1, "the login was tried");
    assert.equal(apiRequests(requests, "search3").length, 1, "then Subsonic answered");

    await plugin.browse({ page: "songs:100" });
    assert.equal(fake.state.probes.length, 1, "the not-Navidrome answer lasts the session");
    assert.equal(fake.state.logins.length, 1, "and no login is attempted again");
    assert.equal(apiRequests(requests, "search3").length, 2, "Subsonic serves the pages meanwhile");
  });

  test("the negative answer is also forgotten by setSetting and signOut", async () => {
    const fake = fakeNavidrome({ probeStatus: 404 });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.probes.length, 1, "probed once, then cached");
    plugin.setSetting({ key: "server", value: "https://music.example.com" });
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.probes.length, 2, "a setting change probes again");

    plugin.signOut();
    await plugin.browse({ page: "songs" });
    assert.equal(fake.state.probes.length, 3, "signing out probes again");
  });

  test("a probe that can't be reached falls back instead of failing", async () => {
    const fake = fakeNavidrome({
      probe: () => {
        throw new TypeError("fetch failed");
      },
    });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic still shows the library");
    assert.equal(fake.state.logins.length, 0, "no login was attempted");
    assert.equal(apiRequests(requests, "search3").length, 1);
  });

  test("a login answer without a usable token falls back", async () => {
    for (const [label, answer] of [
      ["no JSON", { status: 200, text: "not json at all" }],
      ["no token", { status: 200, json: { user: "alice" } }],
      ["token not a string", { status: 200, json: { token: 42 } }],
    ]) {
      const fake = fakeNavidrome({ login: () => answer });
      const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
      const page = await plugin.browse({ page: "songs" });
      assert.equal(songsPage(page).tracks.length, fake.db.songs.length, `${label}: Subsonic answered`);
      assert.equal(apiRequests(requests, "search3").length, 1, `${label}: the fallback ran`);
      assert.equal(fake.state.songs.length, 0, `${label}: no native page was asked for`);
    }
  });

  test("malformed native JSON falls back to Subsonic", async () => {
    const fake = fakeNavidrome({ songs: () => ({ json: { not: "an array" } }) });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic answered instead");
    assert.equal(apiRequests(requests, "search3").length, 1);
  });

  test("a native song-page error falls back to Subsonic", async () => {
    const fake = fakeNavidrome({ songs: () => ({ status: 500, text: "boom" }) });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, fake.db.songs.length, "Subsonic answered instead");
    assert.equal(apiRequests(requests, "search3").length, 1);
  });

  test("the Subsonic fallback pages with songOffset and links", async () => {
    const db = makeDb();
    db.songs = subsonicSongs(250);
    const fake = fakeNavidrome({ db, probeStatus: 404 });
    const { plugin, requests } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs:100" });
    assert.equal(songsPage(page).tracks.length, 100, "100 songs come back");
    const search = requests.filter((req) => req.apiMethod === "search3")[0];
    assert.equal(search.params.songCount, "100");
    assert.equal(search.params.songOffset, "100", "the fallback pages with songOffset");
    assert.deepEqual(
      linksOf(page),
      [
        { title: "Previous page", page: "songs:0" },
        { title: "Next page", page: "songs:200" },
      ],
      "a full fallback page links both ways",
    );
  });

  test("an empty library says so", async () => {
    const db = makeDb();
    db.songs = [];
    const fake = fakeNavidrome({ db, probeStatus: 404 });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    assert.equal(songsPage(page).tracks.length, 0, "no songs");
    assert.deepEqual(linksOf(page), [], "no paging");
    assert.equal(songsPage(page).empty, "No songs in the library", "the section says the library is empty");
  });

  test("a page id that isn't a page is unavailable", async () => {
    const { plugin } = await loadPlugin();
    for (const page of ["songs:abc", "songs:-1", "songs:x:1"]) {
      const error = await throwsAsync(() => plugin.browse({ page }), `browse(${JSON.stringify(page)}) rejects`);
      assert.equal(errorCode(error), "unavailable", `${page}: there is no such page`);
    }
  });
});

describe("native song mapping", { skip: bundleSkip() }, () => {
  async function mapped(song) {
    const fake = fakeNavidrome({ songs: () => ({ json: [song], headers: { "x-total-count": "1" } }) });
    const { plugin } = await loadPlugin({ db: fake.db, route: fake.route });
    const page = await plugin.browse({ page: "songs" });
    return songsPage(page).tracks[0];
  }

  test("participants, duration and the cover", async () => {
    const track = await mapped(nativeSong());
    assert.equal(track.id, "native-1");
    assert.equal(track.name, "Native Song", "the title is the name");
    assert.equal(track.duration, 245600, "native seconds are MyGo milliseconds");
    assert.deepEqual(track.artists, [{ id: "artist-1", name: "Native Artist" }], "artists come from participants.artist");
    assert.deepEqual(
      track.album.artists,
      [{ id: "artist-1", name: "Native Album Artist" }],
      "album artists come from participants.albumartist",
    );
    assert.equal(track.album.id, "abc123", "the album id is the raw album id");
    assert.equal(track.album.name, "Native Album");
    assert.equal(track.album.released, "2024", "the year is the released string");
    assert.equal(track.unavailable, false, "a present song is playable");

    const cover = new URL(track.album.imageUrl);
    assert.equal(cover.pathname, "/rest/getCoverArt", "the cover is a Subsonic getCoverArt URL");
    assert.equal(cover.searchParams.get("id"), "al-abc123", 'Navidrome cover ids are "al-" + the album id');
    assert.equal(cover.searchParams.get("size"), "{size}");
    assertAuth({ params: Object.fromEntries(cover.searchParams), apiMethod: "getCoverArt" }, CREDENTIALS);
  });

  test("flat artist fields are the fallback when there are no participants", async () => {
    const track = await mapped(
      nativeSong({
        participants: undefined,
        artist: "Flat Artist",
        artistId: "flat-artist",
        albumArtist: "Flat Album Artist",
        albumArtistId: "flat-album-artist",
      }),
    );
    assert.deepEqual(track.artists, [{ id: "flat-artist", name: "Flat Artist" }], "artist/artistId are used");
    assert.deepEqual(
      track.album.artists,
      [{ id: "flat-album-artist", name: "Flat Album Artist" }],
      "albumArtist/albumArtistId are used",
    );
  });

  test("the album falls back to the track's artists when it has none", async () => {
    const track = await mapped(
      nativeSong({ participants: { artist: [{ id: "artist-1", name: "Native Artist" }] }, albumArtist: undefined, albumArtistId: undefined }),
    );
    assert.deepEqual(track.album.artists, track.artists, "the track's artists credit the album too");
  });

  test("a cover id that already has the al- prefix isn't prefixed twice", async () => {
    const track = await mapped(nativeSong({ albumId: "al-ready" }));
    const cover = new URL(track.album.imageUrl);
    assert.equal(cover.searchParams.get("id"), "al-ready", "the prefix guard keeps one prefix");
  });

  test("a song without an album has no cover", async () => {
    const track = await mapped(nativeSong({ albumId: "", album: "" }));
    assert.equal(track.album.id, "");
    assert.equal(track.album.imageUrl, "", "no album id, no cover");
    assert.equal(track.album.name, "");
  });

  test("missing songs are unavailable, missing fields are empty", async () => {
    const track = await mapped(nativeSong({ missing: true, duration: undefined, year: undefined, title: undefined }));
    assert.equal(track.unavailable, true, "a missing file can't be played");
    assert.equal(track.duration, 0, "no duration, zero milliseconds");
    assert.equal(track.album.released, "", "no year, no released string");
    assert.equal(track.name, "");
  });

  test("native requests carry the custom headers", async () => {
    const fake = fakeNavidrome({
      songs: () => ({ json: [nativeSong()], headers: { "x-total-count": "1" } }),
    });
    const customHeaders = '{"X-Api-Key":"key-9"}';
    const { plugin } = await loadPlugin({
      settings: {
        cfAccessClientId: "cf-id",
        cfAccessClientSecret: "cf-secret",
        authorization: "Bearer token",
        cookie: "sid=1",
        customHeaders,
      },
      db: fake.db,
      route: fake.route,
    });
    await plugin.browse({ page: "songs" });
    for (const [label, req] of [
      ["probe", fake.state.probes[0]],
      ["login", fake.state.logins[0]],
      ["songs", fake.state.songs[0]],
    ]) {
      assert.equal(req.header("CF-Access-Client-Id"), "cf-id", `${label}: the Cloudflare client id`);
      assert.equal(req.header("CF-Access-Client-Secret"), "cf-secret", `${label}: the Cloudflare secret`);
      assert.equal(req.header("Authorization"), "Bearer token", `${label}: the Authorization header`);
      assert.equal(req.header("Cookie"), "sid=1", `${label}: the Cookie header`);
      assert.equal(req.header("X-Api-Key"), "key-9", `${label}: the extra headers`);
    }
  });
});
