# 部署必读（NAS 路线）

> 这份文档对应 **NAS 直链路线**：静态页托管在 GitHub Pages / EdgeOne Pages，
> 照片、视频仍放在家里 NAS 上，通过 Cloudflare 临时隧道对外提供。
> 旧的应用版（Express + db.json，托管在 `app.workbuddy.host`）已停更，只作数据源。

---

## 一、这套东西是怎么拼起来的

```
浏览器
  └─ index.html / photos.html / ...
       ├─ data/content.json      ← 内容源（文案、时间轴、照片元数据、NAS 直链）
       └─ scripts/site.js        ← 渲染与交互，只读 content.json

家里 NAS（album-node）
  ├─ /srv/photos   ← 原始照片视频（img/ 与 video/ 两个目录）
  ├─ /srv/pub      ← index.json 媒体清单 + base.json（当前隧道地址）
  └─ Caddy + cloudflared → https://xxxx.trycloudflare.com
```

**关键点：页面不存照片，只存照片的地址。** 地址会随隧道变化，所以中间隔了一层
`base.json`：站点读 `base.json` 拿到当前隧道地址，再拼出每张图的完整 URL。
`deploy-scripts/pub_gh.sh` 负责在隧道重建后把新地址推回仓库。

---

## 二、首次部署

1. 把本目录推到 GitHub 仓库（`elizond0/EdgeOne-album`），根目录即静态站
2. 仓库 Settings → Pages → Source 选 `main` 分支根目录
3. NAS 上执行 `sh deploy-scripts/boot.sh`：起 Caddy、起隧道、写 `base.json`、推 GitHub
4. 打开站点验证首屏图和照片墙能出来

`edgeone.json` 里已声明 `outputDirectory: ./`，同一份代码也能导入 EdgeOne Pages，二选一即可。

---

## 三、日常更新：加照片（最常用）

照片**不在网页后台上传**，直接放 NAS 目录就行：

```bash
# 1. 把新照片丢进 NAS 的 /srv/photos/img/
# 2. 在 NAS 上重跑媒体清单生成（生成 /srv/pub/index.json）
# 3. 回到网页后台 admin.html：「保存并导出 content.json」
# 4. 把下载下来的 content.json 覆盖到站点根目录 data/content.json
# 5. 提交推送
git add data/content.json && git commit -m "chore: 更新照片" && git push
```

第 2 步的清单生成器把每个文件的相对路径、拍摄日期、宽高、类型（photo/video）、
字节数写进 `index.json`。**没有它新照片不会出现在站点里。**

> 本地重建 content.json（不需要 NAS 在线也能做，只要 `index.json` 拉得到）：
> ```bash
> python3 scripts/build_content.py
> ```
> 它会读 `base.json` 的地址去拉 NAS 清单，再与旧库元数据按文件名合并。

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
| 首页设置（在基本信息页下半） | 时间轴条数、照片墙行数、随手记行数、心愿条数、影像板块显示/隐藏/自动、板块顺序上下移 |
| 站点文本 | 全站文案（标题、各板块的小标题与说明、导航文字……） |
| 时间轴 / 随手记 / 愿望清单 / 事件 | 增删改 |
| 照片库 | 描述、日期、省市区地点、隐藏（不上墙）、精选；支持按文件名/描述/地点搜索、按地点分组视图 |

**改完记得导出。** 页面顶部会出现「有未导出的改动」提示，关页面前会拦一下。

---

## 五、必须知道的坑

### 1. 隧道地址会变

`trycloudflare.com` 是临时隧道，NAS 重启或隧道断开重连，地址就换了。
换完要做两件事：

- NAS 上 `boot.sh` 自动写 `/srv/pub/base.json` 并推 GitHub
- **站点仓库里的 `data/content.json` 也要重跑一次 `build_content.py`**，
  因为里面每个 `src` 都是拼死的完整 URL

如果家里 NAS 没开机，站点能打开、但所有照片视频都是裂的。这是这条路线固有的代价。

### 2. 重跑 `build_content.py` 不会抹掉后台配置

脚本从旧库 `love-album-app/data/db.json` 读文案与元数据，但旧库里**没有** `meta.home`
（首页行数/顺序这些是新加的）。所以脚本会先把现有 `content.json` 里的 `meta.home`
原样带过来，再合并。改过这段逻辑的话务必保留这个行为，否则后台调好的首页设置会被冲掉。

### 3. 文件名归一匹配

DB 元数据与 NAS 文件靠文件名关联，规则是：去目录、转小写、剥掉 `(20260613-162348)` 这种后缀、去扩展名。
两边文件名不一致就配不上，照片会变成「无标题」但**不会丢**（NAS 有就渲染）。

### 4. 后台口令只是「本地编辑锁」

`admin.html` 的口令做 SHA-256 哈希比对，默认值写在 `scripts/admin.js` 的 `DEFAULT_HASH`。
它挡的是「随手翻到链接的人」，不是真正的账号系统 —— 哈希在公开仓库里，懂技术的人可以暴破。
真正的保护仍然是「链接不公开 + `noindex`」。

忘了改过的口令：清掉本站的浏览器存储（localStorage），会回到默认口令。

### 5. 视频目前没有宽高和拍摄日期

NAS 清单里视频的 `w`/`h`/`d` 都是 0 或空。页面会在 `loadedmetadata` 后自己判断横竖：
竖拍（1080×1920）改竖版卡片 + `object-fit: contain`，避免被裁成一条横缝。
若以后清单生成器补上宽高和日期，把下方标题改成日期显示会自动生效。

---

## 六、验收清单（每次改完过一遍）

```bash
python3 -m http.server 8791   # 本地起站
```

- 三档视口 375 / 768 / 1440：无横向滚动、无 JS 报错、无零尺寸元素
- 首页：首屏高度 ≈ 视口高度 − 导航高；板块顺序与 CHAPTER 编号对应；照片数是 行数×4（手机 ×2）
- 照片墙：点开灯箱 → 左右切换 → Esc 关闭
- 地点筛选：下拉里数量之和 = 照片总数
- 后台：改一个数字 → 直接点「保存并导出」→ 下载的 json 里能查到改动
  （导出前会自动同步表单，不必先点「保存基本信息」）

---

## 七、和旧应用版的关系

| | 旧应用版 `love-album-app` | NAS 路线 `love-album`（当前主线） |
|---|---|---|
| 运行方式 | Express + `data/db.json` 单 JSON 库 | 纯静态 + NAS 直链 |
| 照片位置 | `assets/album/`（仓库内，561 张） | NAS `/srv/photos/` |
| 后台保存 | 写 db.json | 导出 content.json 手动覆盖 |
| 数据量 | 561 张 | 562 张（多 1 张 NAS 独有的 img_6531） |

旧库现在只剩一个作用：**当元数据源**（标题、描述、地点、时间轴、随手记、心愿这些）。
照片文件本身已经全部由 NAS 提供，`assets/album/` 可以不进仓库。
