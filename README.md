# 我们的故事 · 恋爱纪念册（综合版静态页）

纸质手账 × 拍立得风格的恋爱纪念单页：相恋天数、时间轴、照片墙（灯箱 + 本机上传）、影像区（本机上传）。

> **⚠ 现状更新（2026-11-15 起）**
> 照片与视频已迁移到 NAS 直链，页面**不再读取** `assets/photos/` 和 `scripts/config.js` 里的 `PHOTOS` / `VIDEOS`。
> 加照片的正确路径：原图放进 NAS 的 `共享文件夹/Photos/` → 跑 `deploy-scripts/` 下的处理脚本 → 刷新页面。
> 本次改动清单、线上基线指纹与合并方式见 [MERGE-NOTES.md](MERGE-NOTES.md)。

## 怎么更新内容（不用懂代码）

| 想改什么 | 去哪里改 |
|---|---|
| 纪念日（相恋天数自动算） | `scripts/config.js` → `SITE.anniversary` |
| 照片 | ① 页面上点「＋ 上传照片」（仅本设备浏览器可见）；② 想让所有人看到：把照片放进 `assets/photos/`，在 `scripts/config.js` 的 `PHOTOS` 里登记 |
| 视频 | ① 页面上点「＋ 上传视频」（仅本设备可见）；② 正式收录：放入 `assets/videos/` 并在 `VIDEOS` 里登记 |
| 时间轴节点 | `index.html` 搜索 `timeline__item`，复制一段改文字即可 |
| 首屏合照 | 替换 `assets/photos/photo-05.jpg`，或改 `index.html` 里 hero 图片的 `src` |

## 上传功能的边界（重要）

页面是纯静态站、没有服务器，所以「上传」的照片/视频保存在**上传者自己浏览器的 IndexedDB** 里：

- 刷新、重启浏览器都不会丢（除非主动清除浏览器数据）；
- 换设备、换浏览器、其他访客都看不到；
- 想把内容永久收录进站点（所有人可见），仍需把原文件发给维护者，由维护者放入 `assets/` 并登记到 `config.js` 后重新发布。

## 本地预览

```bash
cd love-album
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

直接双击 `index.html` 也能打开（图片字体走 CDN 时需联网）。

## 隐私说明

- 页面已加 `<meta name="robots" content="noindex, nofollow">`，禁止搜索引擎收录；
- 所有素材都在本地文件里，不经过任何第三方图床；
- 分享方式：把整个文件夹静态部署后，只把链接发给想给的人看。

## 目录结构

```
love-album/
├── index.html            # 页面结构（时间轴文字也在这里改）
├── styles/               # tokens / base / components 三层样式
├── scripts/
│   ├── config.js         # ★ 所有内容配置都在这里
│   └── main.js           # 渲染与交互逻辑（一般不用动）
└── assets/
    ├── photos/           # 照片（当前为占位图 photo-01~12.jpg）
    └── videos/           # 视频 + 默认封面 poster.jpg
```
