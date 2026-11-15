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
  ├─ /srv/csy   ← 原始照片视频（暂存区，只读挂载）
  ├─ /srv/pub   ← 发布产物：img/ 原图、img/t/ 缩略图、video/、index.json、base.json
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

## 三、日常更新：加照片（最常用）

照片**不在网页后台上传**，直接放 NAS 目录就行：

```bash
# 1. 新照片丢进 NAS 的 /srv/csy/
# 2. NAS 上一条命令跑完全链路：
sh /var/lib/tailscale/setup-nas.sh
#    内部顺序：生成缩略图 → 重建 index.json → 核对隧道地址
# 3. 回网页后台 admin.html，为新增照片补描述/地点（可选）
# 4. 「保存并导出 content.json」→ 覆盖到站点 data/content.json
# 5. git add data/content.json && git commit -m "chore: 更新照片" && git push
```

第 2 步如果是从零开始（`/srv/pub/img` 还是空的），要先跑一次原图转换：

```bash
python3 /var/lib/tailscale/pub_img.py /srv/csy /srv/pub
python3 /var/lib/tailscale/pub_vid.sh
sh      /var/lib/tailscale/setup-nas.sh
```

> `mkindex.py` 里视频的拍摄日期与宽高由 `ffprobe` 读取（NAS 上要装 ffmpeg；
> 没装也能跑，只是视频会退化成「无日期、靠浏览器判竖横」）。

> 本地重建 content.json（不需要 NAS 在线也能做，只要 `index.json` 拉得到）：
> ```bash
> python3 scripts/build_content.py
> ```
> 它会读 `base.json` 的地址去拉 NAS 清单，再与 `data/seed.json` 按文件名合并。

---

## 四、日常更新：改文案 / 调首页

全部在 `admin.html` 里做，**没有后端，所以「保存」= 导出文件**：

1. 打开 `admin.html`，输管理口令 —— **默认是 `our-story-2025`**，
   进去后在「基本信息 → 修改口令」可改（只改本机浏览器，不同步其他设备）
2. 改完点右上角 **「保存并导出 content.json」**
3. 把下载的文件覆盖到 `data/content.json`，刷新页面即生效

后台能改的东西：

| 标签页 | 内容 |
|---|---|
| 基本信息 | 纪念日、双方昵称、首屏照片文件名 |
| 首页设置（在基本信息页下半） | 时间轴条数、照片墙首屏行数、滚动加载上限行数、随手记行数、心愿条数、影像板块显示/隐藏/自动、板块顺序上下移 |
| 站点文本 | 全站文案（标题、各板块的小标题与说明、导航文字……） |
| 时间轴 / 随手记 / 愿望清单 / 事件 | 增删改 |
| 照片库 | 描述、日期、省市区地点、隐藏（不上墙）、精选；支持按文件名/描述/地点搜索、按地点分组视图 |

**改完记得导出。** 页面顶部会出现「有未导出的改动」提示，关页面前会拦一下。

---

## 五、首页为什么只铺 3 排

隧道实测带宽 90~450 KB/s（抖动很大），一张原图 1 MB 要两三秒。
一次性铺 24 张的后果不是「慢」，而是**每张都被摊薄，整片同时在转圈，观感像卡死**。

所以首页照片做了三层控制：

| 层 | 做法 | 参数 |
|---|---|---|
| 分批渲染 | 首屏只铺 3 排（桌面 12 张 / 手机 6 张），滚到板块底部再补下一批 | 后台「首屏行数」/「最多行数」 |
| 懒加载 | 卡片进入视口前 400 px 才开始请求 | `site.js` 的 `wallIO` rootMargin |
| 并发闸门 | 同时最多 4 张在途，其余排队 | `site.js` 的 `IMG_LIMIT` |

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

## 七、缩略图（提速的关键一步）

原图长边 2048、单张 200 KB~1.2 MB。四列网格里每张只占 300 px 宽，下原图是纯浪费。

`mkthumb.py` 在原图旁边生成 `img/t/` 缩略图（长边 720、q78、progressive），
实测 **9.8 MB → 1.2 MB（12%）**，单张 890 KB → 103 KB。

```bash
sh /var/lib/tailscale/setup-nas.sh          # 增量，已生成的跳过
sh /var/lib/tailscale/setup-nas.sh --full   # 全量重建（改过 --edge 参数后用）
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
真正的保护仍然是「链接不公开 + `noindex`」。

忘了改过的口令：清掉本站的浏览器存储（localStorage），会回到默认口令。

### 4. 视频元数据依赖 NAS 上重跑 mkindex.py

`mkindex.py` 用 ffprobe 读真实宽高与 `creation_time`（没有就退回文件修改时间），
并处理手机竖拍的 rotation 标记。**必须先在 NAS 上重跑一次**，`index.json` 才会有这些字段；
在那之前视频仍是 `0/0/空`，页面会在 `loadedmetadata` 后自己判断横竖兜底。

### 5. NAS 没开机时站点什么样

页面照常打开（文字、时间轴、随手记都在），图片位置显示手账风占位图
（「照片在 NAS 上睡着了 / NAS OFFLINE」）。这是这条路线固有的代价。

### 6. content.json 有 10 分钟缓存，改完可能看不到

GitHub Pages 给 `data/content.json` 的 `Cache-Control` 是 `max-age=600`，浏览器 10 分钟内
不会重新请求。覆盖并推送后想立刻看到效果：**Ctrl/Cmd + Shift + R 强制刷新**。

> 为什么不给 content.json 加时间戳绕缓存：每次换 query 等于每次强制回源，
> 实测回源要 2~30 秒，而命中缓存是几十毫秒。用 15 KB 的缓存命中换 2 秒的等待，不值。
> 只有 110 字节的 `base.json` 是例外——隧道地址一变就必须尽快生效，所以它每次 bust。

### 7. 内容真的拉不到时会有横幅

`site.js` 里 `content.json` 失败重试 3 次（400/800 ms 退避），`base.json` 重试 2 次。
三次都失败才在页面顶部挂一条深色横幅，写明原因并给「重新加载」按钮。

之前这里是一失败就 `return`，用户看到的是「全是默认文案 + 破图」，看起来像网站坏了。

---

## 十、验收清单（每次改完过一遍）

```bash
python3 -m http.server 8791   # 本地起站
```

- 三档视口 375 / 768 / 1440：无横向滚动、无 JS 报错、无零尺寸元素
- 首页照片：首屏 3 排（桌面 12 / 手机 6），滚到底追加到「最多行数」
- 灯箱：点开先出缩略图、随后换原图；左右切换、Esc 关闭正常
- 照片墙：地点筛选里数量之和 = 照片总数
- 后台：改一个数字 → 直接点「保存并导出」→ 下载的 json 里能查到改动，
  且 `src` 仍是相对路径（不含 `https://`）、没有残留 `thumb` 字段
- NAS 侧：`tail -f /var/lib/tailscale/base-sync.log` 能看到 `OK 地址未变`

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
