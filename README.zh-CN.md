# 适用于 MyGo Music 的 Navidrome 插件

[English](README.md) · **简体中文**

[MyGo Music](https://github.com/egoist/mygo-music) 的
[Navidrome](https://www.navidrome.org/) 音源插件，也兼容其他
Subsonic / OpenSubsonic 服务器。支持自定义 HTTP 请求头，因此也能连接带请求头
鉴权的反向代理背后的服务器。

## 功能

- 首页：随机推荐、最近添加和最常播放的专辑、收藏的专辑和艺术家、播放列表。
- 浏览专辑、艺术家和播放列表。
- 搜索歌曲、专辑、艺术家和播放列表，输入时显示建议。
- 收藏的歌曲、专辑，以及关注的艺术家。
- 创建、重命名、删除播放列表；添加、移除和排序歌曲。
- 按 MyGo Music 的音质设置播放：MP3 最高 128 kbps（标准）、MP3 最高
  320 kbps（高音质），或播放器支持原始格式时直接播放原文件。
- 可选的播放记录上报，以及本地最近播放列表。

## 安装

1. 在 MyGo Music 中打开 **设置 → 插件 → +**，从 GitHub 安装：
   `amorphobia/mygo-music-navidrome`。
2. 或从最新的 GitHub Release 下载 ZIP，然后从本地文件安装。
3. 在插件设置中填写 **服务器地址**、**用户名** 和 **密码**。只有服务器位于
   反向代理之后时，才需要填写可选的请求头字段。

## 兼容性

- Navidrome，以及其他实现 Subsonic / OpenSubsonic 1.16.1 API 的服务器。
- MyGo Music 0.1.20 或更新版本。

## 许可证

[AGPL-3.0-only](LICENSE)
