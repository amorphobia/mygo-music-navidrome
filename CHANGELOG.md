# Changelog

All notable changes to the Navidrome plugin for MyGo Music are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository URL in release links is
`https://github.com/OWNER/mygo-music-navidrome` until the project is published;
replace the placeholder with the real owner at that point.

## [Unreleased]

## [0.1.0] - 2026-11-09

Initial release. The plugin is published as **Navidrome** (id `amorphobia-navidrome`) from
the repository `mygo-music-navidrome`.

### Added

- Configure a Navidrome (or other Subsonic / OpenSubsonic) server address and
  account in the plugin settings; saving them loads the library, and a refused
  request opens the plugin settings with the reason.
- Custom HTTP headers on every request path: the plugin API calls, the cover
  images fetched by MyGo Music, and the audio streams fetched by MyGo Music.
  Supported header fields are Cloudflare Access service-token Client ID and
  Client Secret, `Authorization`, `Cookie`, and an arbitrary JSON object of
  extra headers.
- Dependency-free packaging script that builds a MyGo-installable ZIP containing
  `plugin.json`, `index.js` and `locales/`, with verification of the archive
  layout and a platform-agnostic asset name (`amorphobia-navidrome-<version>.zip`).
- Home page with random picks, recently added, recently played and most played
  albums, favourite albums and artists, and playlists.
- A Songs page with the whole library. On Navidrome it is sorted by title
  through Navidrome's native API (detected automatically); other Subsonic
  servers get the library in the server's natural order. Random picks use
  Navidrome's `getRandomSongs(size=20)`, a uniform random sample of the whole
  library that is not personalized; MyGo Music keeps the loaded Home page for
  about an hour.
- Browse pages for albums (recently added, recently played, most played, all
  albums A–Z, favourite albums, with paging), artists (by index letter) and
  playlists (mine and saved).
- Search across tracks, albums, artists and playlists, with suggestions while
  typing.
- Liked songs, saved albums and followed artists.
- Playlist management: create, rename and delete playlists, add tracks to and
  remove tracks from playlists, and reorder tracks within a playlist.
  Reordering re-sends the whole playlist through `createPlaylist`, so it works
  for playlists of up to 400 tracks.
- Streaming with quality mapping: `standard` and `high` request MP3 transcoding
  at up to 128 and 320 kbps, `lossless` requests the original file when its
  format is supported, and unsupported formats fall back to MP3 at 320 kbps.
- Scrobbling to the server on the played event, controlled by an optional
  "Save listening history" setting (off by default).
- A local "recently played" list kept by the plugin.
- Best-effort lyrics lookup from the server's Subsonic endpoint.
- English and Simplified Chinese interface.
- AGPL-3.0-only license.
- CI workflow that builds from `src/`, verifies the committed `index.js` is up
  to date, and runs the test suite; release workflow that publishes the plugin
  ZIP on `v*` tags.

### Changed

- The plugin is named **Navidrome** with id `amorphobia-navidrome`, matching the
  server it talks to; the repository is still `mygo-music-navidrome`. The id is
  unique to this plugin, so it can be installed alongside the older
  `navidrome`-id plugins from `TengYangTuoHai/mygo-music-navidrome` and
  `rocona/mygo-navidrome`.
- The release asset is named `amorphobia-navidrome-<version>.zip` (derived from the
  manifest id), still without a platform word so the app treats it as universal.
- Released under AGPL-3.0-only.

### Known limitations

- No radio stations or podcasts.
- Playlists longer than 400 tracks cannot be reordered from MyGo Music, because
  Subsonic has no reorder call and the plugin has to re-send the whole playlist
  in one request; very long playlists would exceed some reverse proxies'
  request-URL limits. Reorder those playlists in Navidrome.
- Cover images are fetched by MyGo Music itself, so they only carry the fixed
  header names declared in `plugin.json` (`CF-Access-Client-Id`,
  `CF-Access-Client-Secret`, `Authorization`, `Cookie`). Arbitrary header names
  from the extra-headers JSON reach the API and audio requests only.
- One server and one account per installation.
- Multiple server addresses are not supported: MyGo Music's manifest
  `requestHeaders` host placeholder resolves a single URL, so multi-address
  support is deferred until the app can bind those headers to more than one
  host.
- MyGo Music 0.1.22's plugin settings are plain text inputs: the password,
  service-token Client ID/Secret, `Authorization` and `Cookie` values cannot be
  masked, and "Save listening history" is entered as `true`/`false` rather than
  chosen from a dropdown. Settings are stored in plain text by the app.
- Headers are not sent when a request redirects to a different hostname.
- Playback quality depends on the server's configured transcoder and the
  account's permissions.
- Lyrics are best effort and depend on the server's lyric data.
