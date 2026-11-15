# 我们的故事 · 恋爱纪念册

纸质手账 × 拍立得风格的私密纪念站：相恋天数、时间轴、照片墙（灯箱 + 地点筛选）、
随手记、心愿清单、影像。多页结构，手机与电脑各一套排版。

**照片和视频不放在仓库里**，全部来自家里 NAS 的直链（见 `DEPLOY.md`）。
仓库里只有页面、样式、脚本和一份 `data/content.json`（文案 + 媒体索引）。

## 页面

| 文件 | 内容 |
|---|---|
| `index.html` | 首页：首屏 + 五个板块（时间轴 / 照片墙 / 随手记 / 心愿单 / 影像），条数与顺序可在后台调 |
| `timeline.html` | 时间轴完整版 |
| `photos.html` | 照片墙完整版 + 地点筛选 + 灯箱 |
| `quotes.html` | 随手记 |
| `wishes.html` | 心愿清单（待解锁 / 已解锁两栏） |
| `videos.html` | 影像 |
| `admin.html` | 管理后台（独立页面，前台无入口；本机口令解锁，只做编辑 + 导出，不写服务器） |

前端页面**没有任何上传入口**，纯展示；所有编辑都收在 `admin.html` 里，
且必须手动输入完整 URL 访问，首页与子页都不放跳转链接。

## 改内容的正确姿势

1. 直接访问 `https://elizond0.github.io/album/admin.html`，输本机管理口令
2. 改完点 **「保存并导出 content.json」**
3. 覆盖仓库里的 `data/content.json`，刷新页面即生效

加照片不走后台：把文件放进 NAS 的照片目录，在 `album-node` 容器里跑一次
`deploy-scripts/nas-setup.sh`（统一文件名小写 + 生成缩略图 + 转码视频 + 抽封面
+ 重建 `index.json` + 拉起域名自愈常驻），再用 `scripts/build_content.py` 重建内容清单。
详细流程和注意事项见 **`docs/相册发布处理-规范.md`**。

## 本地预览

```bash
cd love-album
python3 -m http.server 8791
# http://127.0.0.1:8791
```

必须用 http 打开（页面要 `fetch data/content.json`，`file://` 会被浏览器拦）。
照片能否显示取决于 `base.json` 里的 NAS 隧道地址是否还活着。

## 目录结构

```
love-album/
├── index.html  timeline.html  photos.html  quotes.html  wishes.html  videos.html
├── admin.html                 # 后台（导出 content.json）
├── base.json                  # 当前 NAS 隧道地址（由 base-sync.sh 自动追平）
├── data/content.json          # ★ 唯一内容源（构建产物，含相对路径）
├── data/seed.json             # ★ 元数据快照（标题/描述/地点/时间轴/心愿），构建的输入
├── styles/
│   ├── tokens.css             # 颜色 / 字号 / 间距变量
│   ├── base.css               # 重置与版式基础
│   ├── components.css         # 全部组件样式（含手机断点）
│   └── admin.css              # 后台专用
├── scripts/
│   ├── site.js                # ★ 内容层 + 渲染层，对外 window.Site
│   ├── page-*.js              # 五个子页面的渲染入口
│   ├── admin.js               # 后台逻辑
│   ├── build_content.py       # seed.json + NAS 清单 → data/content.json
│   └── gen_pages.py           # 用统一模板生成 5 个子页面
├── deploy-scripts/
│   ├── boot.sh                # NAS 开机：Caddy + 隧道 + 常驻地址同步
│   ├── setup-nas.sh           # 加完照片跑这个：缩略图 → 清单 → 地址
│   ├── mkthumb.py             # 原图 → img/t/ 缩略图（长边 720，体积 12%）
│   ├── mkindex.py             # 生成 index.json
│   ├── base-sync.sh           # 隧道地址变了就推 GitHub（幂等，带校验）
│   └── systemd/               # 裸机部署用的 service + timer
└── assets/fonts               # 自托管字体（霞鹜文楷子集，非阻塞异步加载）
```

## 隐私

- 全站 `<meta name="robots" content="noindex, nofollow">`，不进搜索引擎
- 素材直连家里 NAS，不经过任何第三方图床
- 后台口令只存浏览器 `sessionStorage`，不上传；它只是一道「别人拿不到你电脑就改不了」的本地锁，
  真正的保护是「链接不公开 + 禁止收录」
