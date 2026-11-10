// Copyright (c) 2026 Xuesong Peng
// SPDX-License-Identifier: AGPL-3.0-only
// Home, and the pages the plugin makes up itself: albums by type, the artists
// by index letter, and the playlists.
//
// A page is a Browse: sections of things, each of which may open another page
// with morePage. The app opens those again through browse({page}).

import { requireAccount } from "./config.js";
import { fail, t } from "./errors.js";
import { toAlbum, toArtist, toPlaylist, toTrack } from "./mappers.js";
import { nativeSongsPage, nativeTrack } from "./navidrome.js";
import { getAlbumList2, getArtists, getPlaylists, getRandomSongs, getStarred2, search3 } from "./subsonic.js";

/** How many albums a home section shows. */
const HOME_SIZE = 18;
/** How many albums one page of an albums list shows. */
const ALBUM_PAGE = 50;
/** How many songs one page of the Songs page shows. */
const SONGS_PAGE = 100;

// The album list types Navidrome supports, and the titles the plugin gives them.
const albumTypes = new Map([
  ["newest", () => t("Recently added")],
  ["recent", () => t("Recently played")],
  ["frequent", () => t("Most played")],
  ["random", () => t("Random albums")],
  ["alphabeticalByName", () => t("Albums A to Z")],
  ["alphabeticalByArtist", () => t("Albums by artist")],
  ["starred", () => t("Favorite albums")],
]);

const albumsIn = (response) => {
  const albums = response && response.albumList2 && response.albumList2.album;
  return Array.isArray(albums) ? albums : [];
};

const artistsIn = (response) => {
  const artists = response && response.artists && response.artists.index;
  return Array.isArray(artists) ? artists : [];
};

const playlistsIn = (response) => {
  const playlists = response && response.playlists && response.playlists.playlist;
  return Array.isArray(playlists) ? playlists : [];
};

/** Settled promises whose failures matter: sign-in and setup come through,
 * and so does a server that answered none of them. */
function settle(tasks) {
  return Promise.allSettled(tasks).then((results) => {
    const rejected = results.filter((result) => result.status === "rejected");
    for (const result of rejected) {
      const code = result.reason && result.reason.code;
      if (code === "signIn" || code === "setup") throw result.reason;
    }
    // Nothing worked: say why, rather than show an empty page.
    if (rejected.length === results.length) throw rejected[0].reason;
    return results.map((result) => (result.status === "fulfilled" ? result.value : null));
  });
}

/** The albums section of a page. */
function albumsSection(title, response, morePage, empty) {
  const section = { title, albums: albumsIn(response).map(toAlbum) };
  if (morePage) section.morePage = morePage;
  if (empty) section.empty = empty;
  return section;
}

/** Home: a mix of the library's newest, played and liked things. */
export async function home() {
  requireAccount();
  const [random, newest, recent, frequent, starred, starred2, playlists] = await settle([
    getRandomSongs({ size: 20 }),
    getAlbumList2({ type: "newest", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "recent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "frequent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "starred", size: HOME_SIZE, offset: 0 }),
    getStarred2(),
    getPlaylists(),
  ]);

  const sections = [];
  const songs = random && Array.isArray(random.randomSongs && random.randomSongs.song) ? random.randomSongs.song : [];
  if (songs.length) {
    sections.push({
      title: t("Random picks"),
      pageTitle: t("Random picks"),
      subtitle: t("A fresh mix from your library"),
      tracks: songs.map(toTrack),
    });
  }
  if (newest) sections.push(albumsSection(t("Recently added"), newest, "albums:newest:18"));
  if (recent) sections.push(albumsSection(t("Recently played"), recent, "albums:recent:18"));
  if (frequent) sections.push(albumsSection(t("Most played"), frequent, "albums:frequent:18"));
  if (starred) sections.push(albumsSection(t("Favorite albums"), starred, "albums:starred:18", t("No favorite albums yet")));

  const favorites = starred2 && starred2.starred2 ? starred2.starred2 : {};
  const favoriteArtists = Array.isArray(favorites.artist) ? favorites.artist : [];
  if (favoriteArtists.length) {
    sections.push({ title: t("Favorite artists"), artists: favoriteArtists.map(toArtist) });
  }

  const lists = playlistsIn(playlists).map((playlist) => toPlaylist(playlist));
  if (lists.length) {
    sections.push({ title: t("Playlists"), playlists: lists });
  } else if (playlists) {
    sections.push({ title: t("Playlists"), empty: t("No playlists yet") });
  }

  return { sections };
}

// A song from getRandomSongs is shaped like a track; keep the mapper local to
// avoid importing it twice under a name that also means an album.
function toAlbumTrack(song) {
  return toTrack(song);
}

/** A page the sidebar or a section's morePage opens. */
export async function browse({ page }) {
  requireAccount();
  const name = String(page || "");
  if (!name) return home();
  if (name === "albums") return albumsPage();
  const list = /^albums:([A-Za-z]+):(\d+)$/.exec(name);
  if (list) return albumListPage(list[1], Math.max(0, Number(list[2]) || 0));
  if (name === "artists") return artistsPage();
  if (name === "playlists") return playlistsPage();
  if (name === "songs") return songsPage(0);
  const songPage = /^songs:(\d+)$/.exec(name);
  if (songPage) return songsPage(Math.max(0, Number(songPage[1]) || 0));
  throw fail("unavailable", t("There's no such page"));
}

/** The Albums page: a few ways in, and the whole library by name. */
async function albumsPage() {
  const [newest, recent, frequent, all] = await settle([
    getAlbumList2({ type: "newest", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "recent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "frequent", size: HOME_SIZE, offset: 0 }),
    getAlbumList2({ type: "alphabeticalByName", size: HOME_SIZE, offset: 0 }),
  ]);
  const sections = [];
  if (newest) sections.push(albumsSection(t("Recently added"), newest, "albums:newest:18"));
  if (recent) sections.push(albumsSection(t("Recently played"), recent, "albums:recent:18"));
  if (frequent) sections.push(albumsSection(t("Most played"), frequent, "albums:frequent:18"));
  if (all) sections.push(albumsSection(t("All albums"), all, "albums:alphabeticalByName:18"));
  if (!sections.length) sections.push({ title: t("Albums"), empty: t("No albums in the library") });
  return { title: t("Albums"), sections };
}

/** One page of one album list type. */
async function albumListPage(type, offset) {
  const title = albumTypes.get(type);
  if (!title) throw fail("unavailable", t("There's no such page"));
  const response = await getAlbumList2({ type, size: ALBUM_PAGE, offset });
  const albums = albumsIn(response).map(toAlbum);
  const section = { title: title(), albums };
  if (albums.length === ALBUM_PAGE) section.morePage = `albums:${type}:${offset + ALBUM_PAGE}`;
  if (!sectionsHave(section)) section.empty = t("No albums here");
  return { title: title(), sections: [section] };
}

const sectionsHave = (section) => Array.isArray(section.albums) && section.albums.length > 0;

/** The Songs page: the whole library, in title order where the server can sort it. */
async function songsPage(offset) {
  const native = await nativeSongsPage({ offset, size: SONGS_PAGE });
  let tracks;
  let more;
  if (native) {
    tracks = native.songs.map(nativeTrack);
    more = native.total === null ? tracks.length === SONGS_PAGE : offset + tracks.length < native.total;
  } else {
    // Not Navidrome, or its native API is not reachable: Subsonic can still
    // return the library, in its natural order.
    const response = await search3({ query: "", songCount: SONGS_PAGE, songOffset: offset });
    const songs = response && response.searchResult3 && Array.isArray(response.searchResult3.song) ? response.searchResult3.song : [];
    tracks = songs.map(toTrack);
    more = tracks.length === SONGS_PAGE;
  }
  const section = { title: t("All songs"), tracks };
  // The app's Browse pages have no paging buttons of their own; a link card is
  // how a plugin can offer the pages before and after this one.
  const links = [];
  if (offset > 0) {
    links.push({ title: t("Previous page"), page: `songs:${Math.max(0, offset - SONGS_PAGE)}` });
  }
  if (more && tracks.length) {
    links.push({ title: t("Next page"), page: `songs:${offset + SONGS_PAGE}` });
  }
  if (links.length) section.links = links;
  else if (!tracks.length) section.empty = t("No songs in the library");
  return { title: t("Songs"), sections: [section] };
}

/** The Artists page: a section for each index letter the server gives. */
async function artistsPage() {
  const response = await getArtists();
  const indexes = artistsIn(response);
  const sections = indexes
    .map((index) => ({
      title: String((index && index.name) || ""),
      artists: (Array.isArray(index && index.artist) ? index.artist : []).map(toArtist),
    }))
    .filter((section) => section.artists.length > 0);
  if (!sections.length) sections.push({ title: t("Artists"), empty: t("No artists in the library") });
  return { title: t("Artists"), sections };
}

/** The Playlists page: the listener's own and the ones they saved. */
async function playlistsPage() {
  const response = await getPlaylists();
  const all = playlistsIn(response).map((playlist) => toPlaylist(playlist));
  const mine = all.filter((playlist) => playlist.mine);
  const saved = all.filter((playlist) => !playlist.mine);
  const sections = [
    { title: t("My playlists"), playlists: mine, empty: t("You haven't made a playlist yet") },
  ];
  if (saved.length) sections.push({ title: t("Saved playlists"), playlists: saved });
  return { title: t("Playlists"), sections };
}
