# 合并说明 · NAS 直链改造（2026-11-15）

> ## ⚠️ 历史文档，架构已被取代，不要照着做
>
> 这份交接单描述的是**第一版** NAS 改造（运行时 fetch `base.json` + `index.json`，
> 由 `scripts/nas.js` + `scripts/main.js` 承担）。那套渲染层后来被整体重写：
>
> - `scripts/nas.js` / `main.js` / `config.js` / `api.js` **已删除**
> - 现在由 `scripts/site.js` 读 `data/content.json`，`content.json` 由 `scripts/build_content.py` 生成
> - `content.json` 里存**相对路径**，运行时再拼 `base.json` 的地址
> - 现在要看的是 `DEPLOY.md` 和 `README.md`
>
> **另**：`edgeone.json` 与 `cloud-functions/` 在本次合并后已彻底不用（项目不再涉及 EdgeOne），
> 下面表格里提到它们的行都是**当时的事实快照**，不是现行配置，别照着建。
>
> 这份文件保留下来只为了两件事：记录当时的三处嵌入点为什么那样改、以及 md5 核对的方法。
> 关于「页面不再读 `assets/photos/` 和 `config.js` 的 PHOTOS」这个提醒依然成立且更重要了。

> 这份文件是给**另一个对话**看的交接单。它回答三件事：这次改了什么、你手上的副本是不是旧版、怎么合并不打架。
> 分支：`workbuddy/album-nas-pipeline`　基线：`c0b00f0`（2026-10-28）　当前 main HEAD：`f1b4318`

---

## 0. 先看这段：为什么会"版本对不上"

我核对了仓库的全部提交历史（`c0b00f0..f1b4318`，共 12 个提交），事实是：

- 从 10-28 到 11-15 之间，仓库里**没有第二个作者的提交**，全部提交都是本对话用同一个 token 推的；
- 每次推送都是**增量小改**，最大的一次删除是 4 行（`81f6a4c` 改字体加载方式），**不存在整文件覆盖**；
- 所以「我的推送覆盖了你的修改」这个推断在 git 历史层面不成立——你的改动**没有进过这个仓库**。

最可能的真实情况是二选一：

1. 另一个对话改了文件，但**没有 commit/push**，改动还留在那个会话的沙箱里；
2. 另一个对话改的是 `scripts/config.js` 的照片列表 / `assets/photos/`，而**页面现在根本不读这两个地方了**（见 §5 第 1 条），所以改了也看不出效果。

不管哪种，处理方式都在 §4。

---

## 1. 这次改了什么（相对 10-28 基线的完整清单）

| 文件 | 状态 | 改动量 | 干了什么 |
|---|---|---|---|
| `scripts/nas.js` | 新增 | +51 | NAS 媒体清单加载层：读 `base.json` 拿隧道地址 → 读 `index.json` 拿全量直链 → 写入 `window.NAS` |
| `deploy-scripts/boot.sh` | 新增 | +26 | NAS 容器开机引导：起 Caddy、起 cloudflared、抓隧道域名、写本地 base.json、推 GitHub |
| `deploy-scripts/pub_gh.sh` | 新增 | +34 | 用 GitHub Contents API 把隧道地址写进仓库根 `base.json` |
| `base.json` | 新增 | +4 | **运行时文件**，`{base, updated}`，由 NAS 自动改写 |
| `.nojekyll` | 新增 | 0 | 关掉 GitHub Pages 的 Jekyll 处理 |
| `index.html` | 修改 | +35/-2 | ① 字体改为 `load` 后动态注入 ② 引入 `scripts/nas.js` ③ 加 `.reveal` 可见性兜底 |
| `scripts/main.js` | 修改 | +8 | `renderAll()` 开头插入 NAS 加载，成功则用 NAS 数据覆盖 `window.PHOTOS` / `window.VIDEOS` |
| `edgeone.json` | 修改 | +12 | 给 `/base.json` 加 `no-store`、`/index.json` 加 `no-cache` |

**没有动的文件**：`styles/*`、`scripts/config.js`、`scripts/api.js`、`assets/*`、`cloud-functions/*`、`README.md`、`DEPLOY.md`。这些地方你随便改，不会跟我冲突。

---

## 2. 本分支新增的文件（相对 main 是纯新增，零冲突）

| 文件 | 用途 |
|---|---|
| `MERGE-NOTES.md` | 本文件 |
| `deploy-scripts/Caddyfile` | 之前只存在于 NAS 上、仓库里没有，这次补进来（丢掉就无法重建链路） |
| `deploy-scripts/pub_img.py` | 图片六步处理（EXIF 取日期 → 烘焙方向 → RGB → 2048 → q85 渐进 → 小写名） |
| `deploy-scripts/pub_vid.sh` | 视频 HLG HDR → H.264 SDR 转码（带 tonemap，不做会画面发灰） |
| `deploy-scripts/mkindex.py` | 合并图片索引 + 视频目录，生成 `index.json` |
| `deploy-scripts/docker-compose.example.json` | 容器编排示例（密钥走环境变量，未写入仓库） |
| `deploy-scripts/README.md` | 脚本执行顺序与依赖 |
| `docs/相册发布处理-规范.md` | 图片/视频/目录的强制规则，含踩坑记录 |

---

## 3. 当前线上基线指纹（判断你的副本是否落后）

拿 md5 一比就知道你的副本停在哪个版本：

| 文件 | 大小 | md5 |
|---|---|---|
| `index.html` | 8432 | `fec0c29df99868f2b1a2183f3162fdb3` |
| `scripts/main.js` | 15970 | `824eb9906d3f36baaa01df8a4e93d46f` |
| `scripts/nas.js` | 1871 | `dccfbad45e56f720935c76b5a3257558` |
| `scripts/config.js` | 3080 | `c7ed9689ce5f916b814390b81f0b7266`（未改动） |

命令行自查：

```bash
md5sum index.html scripts/main.js scripts/nas.js
```

如果你的 `index.html` 不是 `fec0c29...`，说明你的副本落后或超前，按 §4 处理。

**线上实测（2026-11-15 16:05）**：`index.json` 返回 578 项（562 图 + 16 视频），单图 443 KB / 3.1 s，视频下行 734 KB/s，GitHub Pages 首页 200。链路是通的。

---

## 4. 怎么合并（另一个对话照这个顺序做）

### 第 1 步：先把你的改动落到 git，别留在工作区

```bash
cd <你的仓库目录>
git status                    # 看有没有未提交的改动
git stash push -u -m "wip: 另一对话的改动"   # 有就暂存，没有跳过
```

### 第 2 步：拉最新 main

```bash
git fetch origin
git log --oneline origin/main -15    # 应该能看到 f1b4318 在最上面
git checkout main && git pull --ff-only origin/main
```

### 第 3 步：把你的改动接到新 main 上

```bash
git checkout -b my-changes
git stash pop                 # 第 1 步有 stash 才需要
git status                    # 看哪些文件冲突
```

### 第 4 步：只有这三个文件可能冲突，改法固定

| 文件 | 冲突时怎么办 |
|---|---|
| `index.html` | 保留 main 的版本，然后**只把你的文字改动重新贴进去**。我在里面只动了三处：字体 `<link>` 注释块、`<script src="scripts/nas.js">` 这一行、`</body>` 前的两个兜底 `<script>`。其余段落（导航、hero、时间轴 `timeline__item`、照片墙容器、弹窗）**原样保留就是最新的**。 |
| `scripts/main.js` | 保留 main。我的改动只有 `renderAll()` 开头的 8 行（NAS 加载），函数体其余部分没动。你要改渲染逻辑，改在 `renderAll` 里 8 行之后即可。 |
| `edgeone.json` | 保留 main。我加的是 `/base.json` 和 `/index.json` 两条 header 规则，追加在 `headers` 数组末尾。 |

`base.json` **一定不要手动改、不要解冲突**——它由 NAS 每次开机自动重写，冲突时直接取远端：

```bash
git checkout --theirs base.json && git add base.json
```

### 第 5 步：推送并发 PR

```bash
git push -u origin my-changes
gh pr create --base main --head my-changes --title "..." --body "..."
```

不熟 `gh` 就直接在网页上点 **Compare & pull request**。

---

## 5. 改内容前必须知道的四件事（这是这次最大的坑）

### 1. 照片/视频**不再读** `assets/photos/` 和 `config.js` 的 `PHOTOS` 数组

`scripts/main.js` 的 `renderAll()` 现在是这个优先级：

```
window.NAS.load() 成功 → 用 NAS 的 578 项覆盖 window.PHOTOS / window.VIDEOS
                    ↓ 失败
              回退到 config.js 的 PHOTOS + IndexedDB 本机上传
```

所以往 `assets/photos/` 里加图、在 `config.js` 的 `PHOTOS` 里登记，**页面上不会出现**。要加照片，正确做法是把原图放进 NAS 的 `共享文件夹/拓展工具/照片展示/csy/`（容器内 `/srv/csy`，2026-11-16 前的路径是 `共享文件夹/Photos/`），然后跑一遍 `pub_img.py` + `mkindex.py`。

如果你想改回「静态图优先」，把 `renderAll()` 里那 8 行 `if (window.NAS && window.NAS.load)` 删掉就行，NAS 直链会退化成不生效（但 `nas.js` 留着不报错）。

### 2. `base.json` 是运行时文件，不是配置

隧道域名每次容器重启都会变（`trycloudflare.com` 的免费隧道没有固定域名），NAS 开机时抓新域名写进 `base.json` 并推 GitHub。所以仓库里这个文件的 `updated` 时间戳会自己跳，**这属于正常噪音，不要以为是别人改的**。

### 3. 字体不能同步引入

`assets/fonts/wenkai.css` 有 210 KB、按 unicode-range 切了上百个 woff2。用 `<link rel="stylesheet">` 同步引入会把 `document.readyState` 卡在 `interactive` 二十秒，`DOMContentLoaded` 不触发，照片墙直接空白。现在的做法是 `load` 事件后 `setTimeout` 动态注入，**别改回同步**。

### 4. `.reveal` 必须补 `.in`

样式里 `.reveal{opacity:0}`，靠 IntersectionObserver 加 `.in` 变可见。无头浏览器和部分 WebView 里这个观察器不回调，卡片 DOM 存在、图也加载了，就是肉眼看不见。`index.html` 末尾那个 `setInterval(tick, 1000)` 是兜底，别删。

---

## 6. 不要做的事

- **不要把照片/视频提交进仓库**。GitHub 仓库是 public（Pages 免费版不支持私有仓库），媒体全在 NAS，仓库里只有 12 张占位图。
- **不要改源目录（`csy/`，容器内 `/srv/csy`，只读挂载）里的任何文件**。UGOS 相册应用靠 EXIF 拍摄日期建索引，动了元信息索引就散。压缩版只出现在 `album-pub/`。
- **不要把 GitHub token 写进任何文件**。`deploy-scripts/pub_gh.sh` 是从 NAS 的 `/var/lib/tailscale/.gh_token` 读的，仓库里没有明文。

---

## 7. 回滚

站点部分要退回 10-28 的纯静态版（不连 NAS）：

```bash
git revert --no-commit c0b00f0..f1b4318 && git commit -m "revert: 回退 NAS 直链改造"
```

只关 NAS 直链、保留其它修复：删掉 `scripts/main.js` 里 `renderAll()` 开头那 8 行，再删 `index.html` 里的 `<script src="scripts/nas.js"></script>`。
