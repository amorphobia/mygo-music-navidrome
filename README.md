# Navidrome for MyGo Music

**English** · [简体中文](README.zh-CN.md)

A [MyGo Music](https://github.com/egoist/mygo-music) source plugin for
[Navidrome](https://www.navidrome.org/) and other Subsonic / OpenSubsonic
servers. It supports custom HTTP headers, so it also works with a server behind
a header-based reverse proxy.

## Features

- Home with random picks, recently added and most played albums, favourite
  albums and artists, and playlists.
- Browse albums, artists and playlists.
- Search tracks, albums, artists and playlists, with suggestions while typing.
- Liked songs, saved albums and followed artists.
- Create, rename and delete playlists; add, remove and reorder tracks.
- Streaming with MyGo Music's quality setting: MP3 at up to 128 kbps
  (standard), MP3 at up to 320 kbps (high), or the original file when the
  player supports its format.
- Optional scrobbling, plus a local recently played list.

## Install

1. In MyGo Music, open **Settings → Plugins → +** and install from GitHub:
   `amorphobia/mygo-music-navidrome`.
2. Or download the ZIP from the latest GitHub release and install it from a
   local file.
3. In the plugin settings, fill in the **server address**, **username** and
   **password**. The optional header fields are only needed when the server is
   behind a reverse proxy.

## Compatibility

- Navidrome, and other servers implementing the Subsonic / OpenSubsonic API
  1.16.1.
- MyGo Music 0.1.20 or newer.

## License

[AGPL-3.0-only](LICENSE)
