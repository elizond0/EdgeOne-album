# deploy-scripts —— NAS 相册发布链路的全部脚本

一个 Alpine 容器干三件事：**把 NAS 上的媒体变成公网直链、把当前地址自动告诉前端、开机和掉线都能自己恢复**。

```
NAS 文件 ──── 共享文件夹/Photos/csy/ → /srv/csy（只读；578 项 = 562 JPG/PNG + 16 MOV，全在一层）
                            │
                     pub_img.py（2048/q85/去 EXIF）
                            ↓
                     拓展工具/照片展示/img、/video
                            │
                     mkthumb.py → img/t/            （网格用缩略图，体积降到 12%）
                            │
                     mkindex.py → index.json        （带缩略图 t / 封面 p 字段）
                            ↓
                     Caddy :8443 → cloudflared → https://xxx.trycloudflare.com
                            ↓
                     base-sync.sh 常驻 → 地址变了就推 GitHub base.json
                            ↓
                     GitHub Pages 页面读 base.json + content.json → 直链加载
```

## 文件与执行顺序

| 顺序 | 文件 | 谁调用 | 作用 |
|---|---|---|---|
| 1 | `pub_img.py` | `nas-setup.sh` / 手动 | 源目录 → `img/*.jpg` + `img_index.json`（六步处理，顺序不能调）；`--skip-existing` 只处理新增 |
| 2 | `pub_vid.sh` | 手动（老流程） | `*.MOV` → `video/*.mp4`，HLG HDR 转 BT.709 SDR；新流程的转码在 `nas-setup.sh` 里内联 |
| 3 | `mkthumb.py` | `nas-setup.sh` / 手动 | 压缩图 → `img/t/*.jpg`（长边 720，体积降到 12%），增量幂等 |
| 4 | `mkindex.py` | `nas-setup.sh` / 手动 | 合并上两步产出 → `index.json`（带 `t` 缩略图、`p` 封面，站点读的就是它） |
| 5 | `Caddyfile` | `boot.sh` 拷到 `/etc/caddy/` | 静态服务 + CORS + index.json 不缓存 |
| 6 | `boot.sh` | 容器 `command` / rc.local | 装依赖 → 起 Caddy → 起 cloudflared → 挂常驻地址同步 |
| 7 | `base-sync.sh` | `boot.sh`（`--watch 300`） | 抓域名 → 验可达 → 比对 → 推 GitHub → 回读校验 |
| 8 | `nas-setup.sh` | 手动（加完照片/视频） | 一条命令跑完 小写化 → 压缩图 → 视频转码/封面 → 缩略图 → 清单 → 地址同步 |
| — | `pub_gh.sh` | 旧调用兼容 | 转到 `base-sync.sh --url --force` |

## 容器里的路径约定

| 宿主机 | 容器内 | 权限 |
|---|---|---|
| `共享文件夹/Photos/csy` | `/srv/csy` | **只读** ← 压缩图与视频的唯一源 |
| `共享文件夹/拓展工具/照片展示` | `/srv/pub` | 可写（唯一对外发布目录） |
| `共享文件夹/拓展工具/ts-state` | `/var/lib/tailscale` | 可写，存 cloudflared、Caddyfile、各脚本、`orig_video` 原片备份 |

> compose 在 `共享文件夹/拓展工具/docker-compose.yaml`，项目「存放路径」必须选 `共享文件夹/拓展工具`；
> 选成默认的 `共享文件夹/docker/album-node` 会让三个相对挂载全指向空目录。

> 2026-11-17 定稿：原图唯一入口 `共享文件夹/Photos/csy` → `/srv/csy`（只读）；
> 发布目录 `共享文件夹/拓展工具/照片展示` → `/srv/pub`（读写，`img/`、`video/`、`index.json` 都在它下面）。
> `/srv/photos` 已彻底移除。别再写「原片 / 副本」两套 —— 那会让排查先花时间分辨哪个才是真的。

> `ALBUM_HOME` 环境变量可以改脚本家目录，默认 `/var/lib/tailscale`（历史遗留命名，别被名字误导）。

## 一次性准备

```sh
# 容器内
mkdir -p /srv/pub
apk add --no-cache ffmpeg python3 py3-pillow

# 把 GitHub token 落到 ts-state（不要提交进仓库）
printf '%s' 'ghp_xxx' > /var/lib/tailscale/.gh_token && chmod 600 /var/lib/tailscale/.gh_token
```

## 日常发布新照片 / 新视频

照片和视频都放进 `共享文件夹/Photos/csy/`（容器内 `/srv/csy`，只读挂载）。

> 只读挂载下**第 2 步「统一小写」会自动跳过**（`os.rename` 在 ro 上会 EROFS）。
> 这不影响站点：`pub_img.py` 输出时强制 `stem.lower()+".jpg"`，源名大写也不会 404。
> 同理，脚本第 0 步会先数源目录里的媒体文件，**为 0 或源数不到已发布数一半就直接退出**，
> 免得挂错目录还一路「成功」跑完。

```sh
wget -q -O /tmp/nas-setup.sh \
  "https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/nas-setup.sh?x=$(date +%s)"
sh /tmp/nas-setup.sh > /srv/pub/wb_setup.log 2>&1 &
```

脚本自己会把脚本拉到最新版、把新视频入队、转码、抽封面，所以不用再单独跑 `pub_img.py` / `pub_vid.sh`。
`index.json` 更新后刷新页面即可，不需要重启容器、不需要重新推送 GitHub。

## 地址自愈

`base-sync.sh` 每 5 分钟核对一次隧道地址，**没变就什么都不做**（不产生空提交）。
变了会先 `curl index.json` 确认新域名真能打开，再 PUT 到 GitHub，最后回读 Pages 验证生效。

```sh
sh /var/lib/tailscale/base-sync.sh           # 立刻核对一次
sh /var/lib/tailscale/base-sync.sh --force   # 强制重推
sh /var/lib/tailscale/base-sync.sh --watch 300   # 前台常驻（boot.sh 用这个）
tail -f /var/lib/tailscale/base-sync.log     # 看它在干什么
```

裸机部署可用 `systemd/album-base-sync.{service,timer}` 代替常驻循环。

## 已知限制

- `trycloudflare.com` 免费隧道**域名不固定**，容器重启就变。这是免费方案的代价；
  要固定域名只能上 named tunnel（需要域名 + Cloudflare 账号）。现在靠 `base-sync.sh` 自愈。
- Tailscale Funnel 的备选方案实测 **16 KB/s**（走境外 DERP 中继），看照片都卡，已弃用。
- cloudflared 免费隧道实测 **90 KB/s ~ 450 KB/s**（抖动大），所以网格必须走缩略图。
- `img/t/` 会占额外磁盘：实测 562 张压缩图 359.9 MB → 缩略图 42.4 MB（12%）。
- `pub_img.py` 的 `img_index.json` 是按源目录重建的，源里删掉的图会从清单消失。
  默认 `--keep-orphans` 行为会把「源里没有、`img/` 里还在」的图补回清单，
  否则像 `img_6531` 这种原图已丢的历史照片，重跑一次就静默下线了。
- 视频「要不要重转」只能看**封面在不在**（`video/poster/<名>.jpg`）。只比体积会掉进
  「迁走原片 → video/ 空了 → 重转 → 再迁走」的死循环，实测连跑两遍白转 16 个视频。
  自检办法：连跑两遍 `nas-setup.sh`，第二遍 4c 必须全部 `SKIP`。

## 后台写入口 album-push.py（含进门口令）

后台 `/admin.html` 现在有两道门，都落在 NAS 上：

| 时机 | 前端调的接口 | 校验方式 |
|---|---|---|
| 打开后台，先输 6 位口令 | `POST /api/auth` | PBKDF2 比对 `push-secret`，通过则发一个 12 小时令牌 |
| 点「保存并发布」 | `POST /api/save` | 优先认 `X-Admin-Auth: <令牌>`，退回 `X-Admin-Key: <口令>` |

> 为什么口令不能放前端：6 位数字只有 10^6 个候选。任何写在 JS 里的哈希/明文
> 都是公开的，等于没设。所以「对不对」只有 NAS 知道，浏览器里只存一个一次性令牌
> （`sessionStorage`，关标签页即失效）。

### 首次部署 / 改口令

```sh
# 容器内（$P 默认 /var/lib/tailscale）
cd $P
# 1) 拿到新版脚本（容器能出网就能直接拉，不用再逐段粘贴）
wget -qO album-push.py https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/album-push.py
wget -qO Caddyfile     https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/Caddyfile

# 2) 设口令（写 push-secret，pbkdf2，0600）
python3 album-push.py --set-key '125728'

# 3) 让 Caddy 认新的 CORS 头（必须校验，语法错会让整站连照片一起挂）
caddy validate --config $P/Caddyfile && caddy reload --config $P/Caddyfile

# 4) 重启写入口，跑的一定是磁盘上这份
pkill -f album-push.py; sleep 1
python3 album-push.py >>$P/push.log 2>&1 &

# 5) 自检
python3 album-push.py --check     # 期望：secret: pbkdf2 | token: 有
curl -s localhost:8787/api/health # 期望：{"ok":true,"key_set":true,"pbkdf2":true}
```

### CORS 有个必须注意的点

`Caddyfile` 的 `Access-Control-Allow-Headers` 必须包含 **`X-Admin-Auth`**。
漏了它，浏览器预检会把带令牌的提交整个拦掉，前端表现是「一点发布就报连不上 NAS」——
和「NAS 离线」一模一样，很容易查错方向。2026-11-17 就是踩了这个。

### 口令轮换

```sh
python3 album-push.py --set-key '<新口令>'
pkill -f album-push.py; sleep 1; python3 album-push.py >>$P/push.log 2>&1 &
```

旧令牌存在内存里，重启即全部作废——这是有意的：换口令就该踢掉所有已登录会话。
