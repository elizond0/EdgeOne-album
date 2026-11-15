# 部署必读（NAS 路线）

> 静态页托管在 GitHub Pages，照片、视频仍放在家里 NAS 上，
> 通过 Cloudflare 快速隧道对外提供。旧的应用版（Express + db.json）已停更，只作数据源。

---

## 一、这套东西是怎么拼起来的

```
浏览器
  └─ index.html / photos.html / ...
       ├─ data/content.json      ← 内容源（文案、时间轴、照片元数据、相对路径）
       ├─ base.json              ← 当前 NAS 隧道地址（一行 JSON，随时可换）
       └─ scripts/site.js        ← 渲染与交互，运行时把相对路径拼成完整 URL

家里 NAS（album-node 容器）
  ├─ /srv/photos ← 原图原片（共享文件夹 Photos，可写；实测 562 张图 + 16 个视频）
  ├─ /srv/csy    ← 同一批文件的只读暂存副本
  ├─ /srv/pub    ← 发布产物：img/ 压缩图、img/t/ 缩略图、video/、video/poster/、index.json、base.json
  └─ Caddy :8443 + cloudflared → https://xxxx.trycloudflare.com
        └─ base-sync.sh 常驻：盯住地址，变了就推回 GitHub
```

**关键点：页面不存照片，只存照片的地址。** 而地址会随隧道重建而变，所以分了两层：

- `content.json` 里只有 `img/xxx.jpg` 这样的**相对路径**，换地址不用重建、不用重新提交
- `base.json` 存当前隧道域名，`site.js` 在运行时把它和相对路径拼起来

地址变了只要改 `base.json` 一个文件。

---

## 二、首次部署

1. 把本目录推到 GitHub 仓库（`elizond0/album`），根目录即静态站
2. 仓库 Settings → Pages → Source 选 `main` 分支根目录
3. NAS 上执行 `sh deploy-scripts/boot.sh`：起 Caddy、起隧道、常驻地址同步
4. 打开站点验证首屏图和照片墙能出来

`boot.sh` 会做三件事：起 Caddy、起 cloudflared、把 `base-sync.sh --watch 300` 挂到后台。
最后一项是关键——它让「重启后地址自动追平」变成常态而不是一次性动作（见 §六）。

---

## 三、日常更新：加照片 / 加视频（最常用）

照片和视频**都不在网页后台上传**，直接丢进 NAS 的 `共享文件夹/Photos/`（容器内是 `/srv/photos`）。
实测这个目录既有图也有视频：579 项 = 562 张图 + 16 个视频 + 回收站目录。

放好之后，在容器终端里跑**一条命令**：

```bash
wget -q -O /tmp/nas-setup.sh \
  "https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/nas-setup.sh?x=$(date +%s)"
sh /tmp/nas-setup.sh > /srv/pub/wb_setup.log 2>&1 &
# 进度：https://<当前隧道>/wb_setup.log
```

脚本内部八步（可重入，已完成的全部跳过）：

| 步 | 做什么 | 增量判据 |
|---|---|---|
| 1 | 从 GitHub 拉最新脚本（raw 优先 / Pages 兜底，`.tmp` 原子写） | 每轮都拉 |
| 2 | 源目录文件名转小写 | 已是小写跳过 |
| 3 | **生成公网压缩图**（长边 2048、去 EXIF、q85 progressive） | 输出比源新就跳过 |
| 4 | 新增视频入队 → 转码 720p H.264 → 抽首帧封面 | `video/` 与 `poster/` 都在就跳过 |
| 5 | 生成网格缩略图（长边 720、q78） | 输出比源新就跳过 |
| 6 | 重建 `index.json`（带 `t` 缩略图与 `p` 封面字段） | 每轮重建 |
| 7 | 起 `base-sync.sh --watch 300` | 已有 watcher 则跳过 |

跑完刷新页面就能看到新内容，**不需要重启容器、不需要重新推送 GitHub**。

> 第 3 步以前是缺的：只跑缩略图不会把新照片变成公网压缩图，新照片永远进不了站点。
> 现在 `pub_img.py` 支持 `--skip-existing`，加 1 张照片只处理 1 张（全量重编码 562 张要十几分钟）。

### 把清单同步回站点（改完 NAS 后必做）

`content.json` 里的 `thumb` / `poster` 字段来自 NAS 的 `index.json`，所以要重建一次：

```bash
python3 scripts/build_content.py --nas https://<当前隧道>/index.json
python3 scripts/gen_pages.py                 # 刷新子页面与页脚时间戳
git add -A && git commit -m "chore(content): 同步 NAS 清单" && git push
```

### 发布

```bash
sh scripts/release.sh
```

重新生成 5 个子页面（顺带把页脚版本时间戳刷成当前时间）→ 提交 → 推送。
**每次上线都跑这条**，页脚时间才等于这次部署的时间。

站点地址：<https://elizond0.github.io/album/>

> 仓库从 `EdgeOne-album` 改名成 `album` 了，旧地址 `/EdgeOne-album/` 已经 404，
> 之前分享出去的链接要换成新的。GitHub Pages 不会为改名的仓库保留旧路径重定向。

---

## 四、日常更新：改文案 / 调首页

全部在 `admin.html` 里做，**没有后端，所以「保存」= 导出文件**。
前台已移除所有后台入口，需要手动输入 `https://elizond0.github.io/album/admin.html`：

1. 打开后台，输管理口令。默认口令的哈希写在 `scripts/admin.js` 的 `DEFAULT_HASH`
   （公开仓库任何人可读，**进入后请立即在「基本信息 → 修改口令」改掉**，
   改动只存在本机浏览器，不同步其他设备）
2. 改完点右上角 **「保存并导出 content.json」**
3. 把下载的文件覆盖到 `data/content.json`，刷新页面即生效

后台能改的东西：

| 标签页 | 内容 |
|---|---|
| 基本信息 | 纪念日、双方昵称、首屏照片文件名 |
| 首页设置（在基本信息页下半） | 时间轴条数、照片墙首屏行数、滚动加载上限行数、随手记行数、心愿条数、影像板块显示/隐藏/自动、板块顺序上下移 |
| 子页面设置（同一页再往下） | 照片墙页列数（1~4）、每批张数（12~120）、随手记页列数（1~3）、心愿单每组条数（0 = 不限） |
| 站点文本 | 全站文案（标题、各板块的小标题与说明、导航文字……） |
| 时间轴 / 随手记 / 愿望清单 / 事件 | 增删改 |
| 照片库 | 描述、日期、省市区地点、隐藏（不上墙）、精选；支持按文件名/描述/地点搜索、按地点分组视图 |

**改完记得导出。** 页面顶部会出现「有未导出的改动」提示，关页面前会拦一下。

---

## 五、首页为什么只铺 2 排

隧道实测带宽 90~450 KB/s（抖动很大），一张原图 1 MB 要两三秒。
一次性铺 24 张的后果不是「慢」，而是**每张都被摊薄，整片同时在转圈，观感像卡死**。

所以首页照片做了三层控制：

| 层 | 做法 | 参数 |
|---|---|---|
| 分批渲染 | 首屏只铺 2 排（桌面 8 张 / 手机 4 张），滚到板块底部再补下一批 | 后台「首屏行数」默认 2 /「最多行数」默认 6 |
| 懒加载 | 卡片进入视口前 400 px 才开始请求 | `site.js` 的 `wallIO` rootMargin |
| 并发闸门 | 同时最多 4 张在途，其余排队 | `site.js` 的 `IMG_LIMIT` |
| 缩略图 | 网格一律走 `img/t/`（长边 720），灯箱才取 2048 压缩图 | `content.json` 的 `thumb` 字段 |

想加长首页就调「滚动加载后最多行数」（默认 6 排）；想更快就调小首屏行数。

全部照片的完整列表在 `photos.html`，那是**不分批**的（CSS 列瀑布流 + 懒加载），
因为那是一整个列表页，用户预期就是往下翻。

---

## 六、隧道地址会变，现在能自愈

`trycloudflare.com` 是临时隧道，NAS 重启或断线重连都会换域名。旧做法只在开机跑一次，
中途抖一下就永久失联，站点上还看不出原因。

现在是常驻进程：

```
boot.sh
  └─ base-sync.sh --watch 300   每 5 分钟
       1. 从 cloudflared 日志取最新域名
       2. curl 一次 index.json，确认这个域名真的能打开（新域名有几十秒 DNS 空窗）
       3. 和线上 base.json 比对，一样就退出（不产生空提交）
       4. 不一样 → PUT 到 GitHub
       5. 回读 Pages 上的 base.json 校验，确认真的生效了
```

最坏情况：断线 → 重连换域名 → 5 分钟内自动追平。**不需要人管，也不需要重跑构建。**

日志在 `/var/lib/tailscale/base-sync.log`：

```bash
tail -f /var/lib/tailscale/base-sync.log
# OK 地址未变（https://...）           ← 每 5 分钟一条，正常
# PUSH 已提交：https://old → https://new
# LIVE 线上已生效（等待 25s）
```

手动干预：

```bash
sh /var/lib/tailscale/base-sync.sh          # 立刻核对一次
sh /var/lib/tailscale/base-sync.sh --force  # 强制重推
```

裸机（非容器）部署可以用 `deploy-scripts/systemd/` 里的 service + timer 代替常驻脚本，
开机 45 秒后开始，此后每 5 分钟一次。

---

## 七、缩略图与视频封面（提速的关键一步）

压缩图长边 2048、单张 200 KB~1.2 MB。四列网格里每张只占 300 px 宽，下压缩图是纯浪费。

`mkthumb.py` 在压缩图旁边生成 `img/t/` 缩略图（长边 720、q78、progressive）。
实测 562 张：**359.9 MB → 42.4 MB（12%）**，耗时 78.7 秒。

`mkindex.py` 再把视频首帧封面写进清单（`p` 字段），前端 `<video preload="none" poster="...">`，
**不点播放就不下载 mp4**。实测首页首屏流量 68.6 MB → 0.92 MB。

```bash
sh /tmp/nas-setup.sh        # 一条命令全跑（压缩图 → 视频 → 缩略图 → 清单 → 地址自愈）
```

只想重做缩略图时单独跑（输出比源新就跳过，`--force` / `--clean` 可全量重建）：

```bash
python3 /var/lib/tailscale/mkthumb.py /srv/pub --edge 720 --quality 78
python3 /var/lib/tailscale/mkthumb.py /srv/pub --clean      # 清空 img/t/ 后重建
```

它的行为：

- **幂等**：输出比源新就跳过，重复跑只处理新增照片
- **不阻断**：单张失败只记日志，不影响其余照片和 index.json
- **不碰原图**：只读 `img/`，只写 `img/t/`，删了随时可以重来
- **原子写**：先写 `.tmp` 再 rename，Caddy 不会读到半截文件
- **自动清理**：源头已删的照片，对应缩略图也会被清掉

前端怎么用：网格用缩略图，**灯箱仍用原图**（点开先显示已缓存的缩略图，原图在后台加载完再替换，
不会白屏等两三秒）。缩略图缺失时自动退回原图（`data-fallback`），所以没跑脚本站点也不会坏。

---

## 八、字体为什么这样加载

霞鹜文楷切成 194 个 woff2 子集，靠 `unicode-range` 让浏览器只下用得上的那几个（实测 21 个）。

历史上踩过两个坑，都在 `index.html` 里写了注释：

1. **普通 `<link>` 引入会阻塞首屏渲染** —— 194 个子集的样式表把照片墙拖到二十秒后
2. **`window.load` 后再注入会等不到** —— `load` 要等页面所有图片（NAS 上的大图）结束，
   慢图一挂字体永远不来，看起来就是「字体一直没生效」

现在的做法：`media="print"` + `onload` 切回 `all`。不挡渲染，且页面一开始就去拿
（实测首个 woff2 请求在 40 ms，`load` 反而在 58 ms）。

另外 `site.js` 里有个 `Site.watchFonts()`：3 秒内没等到 `document.fonts.ready`，
就往 `<html>` 打 `data-fonts="timeout"`，并加 `fonts-ready` 类。

> **给自动化工具的提醒**：不要 `await document.fonts.ready`，也不要轮询
> `document.fonts.status === 'loaded'`。194 个子集里没被用到的会长期停在 loading，
> 截图/性能采集脚本会永远挂住——看起来像页面卡死，其实内容早就渲染完了。
> 等 `document.documentElement.dataset.fonts` 变成 `loaded` / `timeout` 即可。

---

## 九、必须知道的坑

### 1. 重跑 `build_content.py` 不会抹掉后台配置

脚本从 `data/seed.json` 读文案与元数据，会先把现有 `content.json` 里的 `meta.home`
原样带过来，再合并。改过这段逻辑的话务必保留这个行为，否则后台调好的首页设置会被冲掉。

### 2. 文件名归一匹配

元数据与 NAS 文件靠文件名关联，规则是：去目录、转小写、剥掉 `(20260613-162348)` 这种后缀、去扩展名。
两边文件名不一致就配不上，照片会变成「无标题」但**不会丢**（NAS 有就渲染）。

### 3. 后台口令只是「本地编辑锁」

`admin.html` 的口令做 SHA-256 哈希比对，默认值写在 `scripts/admin.js` 的 `DEFAULT_HASH`。
它挡的是「随手翻到链接的人」，不是真正的账号系统 —— 哈希在公开仓库里，懂技术的人可以暴破。
前台页面已无任何跳转入口，`admin.html` 自身带 `noindex, nofollow`；真正的保护只有
「知道完整 URL 的人才找得到」，**不要把它当成访问控制**。公开仓库里的
`data/content.json` 和 NAS 媒体直链本来就能直接取到，纯静态站做不到服务端鉴权。

忘了改过的口令：清掉本站的浏览器存储（localStorage），会回到默认口令。

### 4. `pub_img.py` 重跑会「删掉」源目录里没有的图（已用孤儿保留兜住）

`img_index.json` 是**按源目录重建**的。有一张 `img_6531` 只活在 `/srv/pub/img`，
原图早就没了 —— 不带保护地重跑一次，它就从清单里消失、站点上少一张，而且**没有任何报错**。

现在 `pub_img.py` 默认把「源里没有、`img/` 里还在」的图按旧条目补回清单（`orphan` 计数会打出来）。
只有确实想让它下线时才加 `--no-orphans`。判据：跑完 `img_index.json` 的 `count`
不低于跑之前的 `index.json` 照片条数。

### 5. 视频元数据依赖 NAS 上重跑 mkindex.py

`mkindex.py` 用 ffprobe 读真实宽高与 `creation_time`（没有就退回文件修改时间），
并处理手机竖拍的 rotation 标记。**必须先在 NAS 上重跑一次**，`index.json` 才会有这些字段；
在那之前视频仍是 `0/0/空`，页面会在 `loadedmetadata` 后自己判断横竖兜底。

### 6. 后台跑脚本必须摘掉 stdin

网页终端里 `cmd > log 2>&1 &` 启动的脚本仍连着 pty。ffmpeg 一旦读 stdin 就吃 `SIGTTIN`
被停住，`ps` 里进程还在、CPU 时间 0、输出文件永远不出现 —— 看起来像「转码很慢」，
其实是挂着。`nas-setup.sh` 开头有 `exec </dev/null`，自己写后台任务时也一样要加。

### 7. NAS 没开机时站点什么样

页面照常打开（文字、时间轴、随手记都在），图片位置显示手账风占位图
（「照片在 NAS 上睡着了 / NAS OFFLINE」）。这是这条路线固有的代价。

### 8. content.json 有 10 分钟缓存，改完可能看不到

GitHub Pages 给 `data/content.json` 的 `Cache-Control` 是 `max-age=600`，浏览器 10 分钟内
不会重新请求。覆盖并推送后想立刻看到效果：**Ctrl/Cmd + Shift + R 强制刷新**。

> 为什么不给 content.json 加时间戳绕缓存：每次换 query 等于每次强制回源，
> 实测回源要 2~30 秒，而命中缓存是几十毫秒。用 15 KB 的缓存命中换 2 秒的等待，不值。
> 只有 110 字节的 `base.json` 是例外——隧道地址一变就必须尽快生效，所以它每次 bust。

### 9. 内容真的拉不到时会有横幅

`site.js` 里 `content.json` 失败重试 3 次（400/800 ms 退避），`base.json` 重试 2 次。
三次都失败才在页面顶部挂一条深色横幅，写明原因并给「重新加载」按钮。

之前这里是一失败就 `return`，用户看到的是「全是默认文案 + 破图」，看起来像网站坏了。

---

## 十、验收清单（每次改完过一遍）

```bash
python3 -m http.server 8791   # 本地起站
```

- 三档视口 375 / 768 / 1440：无横向滚动、无 JS 报错、无零尺寸元素
- 首页照片：首屏 2 排（桌面 8 / 手机 4），滚到底追加到「最多行数」（默认 6）
- 首页视频：3 个 `<video>` 都是 `preload="none"` 且有 poster，`networkidle` 前 **0 个 `.mp4` 请求**，总流量 < 3 MB
- 照片墙：网格请求走 `/img/t/`（找不到就退回压缩图），**原图请求数应为 0**
- 灯箱：点开先出缩略图、随后换压缩图；左右切换、Esc 关闭正常
- 照片墙：地点筛选里数量之和 = 照片总数
- 后台：改一个数字 → 直接点「保存并导出」→ 下载的 json 里能查到改动，
  且 `src` 仍是相对路径（不含 `https://`）、没有残留 `thumb` 字段
- 前台六个页面都**没有** `admin.html` 链接
- NAS 侧：`tail -f /var/lib/tailscale/base-sync.log` 能看到 `OK 地址未变`

> 量 gallery 是否真的走缩略图时注意：卡片是懒加载，只扫 `src` 会得到 0。
> 要么滚动触发，要么同时读 `data-src`；否则会把「懒加载未触发」误判成「缩略图没生效」。

---

## 十一、和旧应用版的关系

| | 旧应用版 `love-album-app` | NAS 路线 `love-album`（当前主线） |
|---|---|---|
| 运行方式 | Express + `data/db.json` 单 JSON 库 | 纯静态 + NAS 直链 |
| 照片位置 | `assets/album/`（仓库内，561 张） | NAS `/srv/pub/img/` |
| 后台保存 | 写 db.json | 导出 content.json 手动覆盖 |
| 数据量 | 561 张 | 562 张（多 1 张 NAS 独有的 img_6531） |

**旧库已经不需要了。** 元数据（标题、描述、地点、时间轴、随手记、心愿、首页配置）
已经提取成仓库内的 `data/seed.json`，`build_content.py` 默认读它。
整个项目现在自包含：克隆这一个仓库 + 能访问 NAS，就能重建全部内容。
（旧路径 `../love-album-app/data/db.json` 只是兜底，找不到 seed.json 时才用。）
