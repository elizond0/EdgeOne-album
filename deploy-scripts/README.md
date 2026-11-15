# deploy-scripts —— NAS 相册发布链路的全部脚本

一个 Alpine 容器干三件事：**把 NAS 上的媒体变成公网直链、把当前地址自动告诉前端、开机和掉线都能自己恢复**。

```
NAS 文件 ──┬─ 原图原片 → 共享文件夹/Photos/        （给 UGOS 相册应用，只读不改）
           └─ 暂存区   → 照片视频/csy/            （容器只读挂载）
                            │
                     pub_img.py / pub_vid.sh
                            ↓
                     album-pub/img、/video
                            │
                     mkthumb.py → img/t/            （网格用缩略图，体积降到 12%）
                            │
                     mkindex.py → index.json        （带缩略图字段 t）
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
| 1 | `pub_img.py` | 手动 / 容器内 python3 | 源目录 → `img/*.jpg` + `img_index.json`（六步处理，顺序不能调） |
| 2 | `pub_vid.sh` | 手动 / 容器内 sh | `*.MOV` → `video/*.mp4`，HLG HDR 转 BT.709 SDR |
| 3 | `mkthumb.py` | `setup-nas.sh` / 手动 | 原图 → `img/t/*.jpg`（长边 720，体积降到 12%），增量幂等 |
| 4 | `mkindex.py` | `setup-nas.sh` / 手动 | 合并上两步产出 → `index.json`（站点读的就是它） |
| 5 | `Caddyfile` | `boot.sh` 拷到 `/etc/caddy/` | 静态服务 + CORS + index.json 不缓存 |
| 6 | `boot.sh` | 容器 `command` / rc.local | 起 Caddy → 起 cloudflared → 挂常驻地址同步 |
| 7 | `base-sync.sh` | `boot.sh`（`--watch 300`） | 抓域名 → 验可达 → 比对 → 推 GitHub → 回读校验 |
| 8 | `setup-nas.sh` | 手动（加完照片） | 一条命令跑完 缩略图 → 清单 → 地址同步 |
| 9 | `bootstrap-nas.sh` | 手动（脚本有更新时） | 从 GitHub / jsDelivr 拉最新脚本到 NAS，再跑 setup |
| — | `pub_gh.sh` | 旧调用兼容 | 转到 `base-sync.sh --url --force` |

## 容器里的路径约定

| 宿主机 | 容器内 | 权限 |
|---|---|---|
| `共享文件夹/照片视频/csy` | `/srv/csy` | 只读 |
| `共享文件夹/照片视频/album-pub` | `/srv/pub` | 可写 |
| `共享文件夹/Photos` | `/srv/photos` | 可写（本链路不写，留给相册应用） |
| `共享文件夹/照片视频/album-pub/../ts-state` | `/var/lib/tailscale` | 可写，存 cloudflared、Caddyfile、各脚本、`.gh_token` |

> `ALBUM_HOME` 环境变量可以改脚本家目录，默认 `/var/lib/tailscale`（历史遗留命名，别被名字误导）。

## 一次性准备

```sh
# 容器内
mkdir -p /srv/pub
apk add --no-cache ffmpeg python3 py3-pillow

# 把 GitHub token 落到 ts-state（不要提交进仓库）
printf '%s' 'ghp_xxx' > /var/lib/tailscale/.gh_token && chmod 600 /var/lib/tailscale/.gh_token
```

## 日常发布新照片

```sh
python3 /var/lib/tailscale/pub_img.py /srv/csy /srv/pub   # 只在有新原图时
sh      /var/lib/tailscale/pub_vid.sh                    # 只在有新视频时
sh      /var/lib/tailscale/setup-nas.sh                  # 缩略图 + 清单 + 地址
```

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
- `img/t/` 会占额外磁盘：约为原图的 12%。562 张原图约 500 MB → 缩略图约 60 MB。
