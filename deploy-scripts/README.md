# deploy-scripts —— NAS 相册发布链路的全部脚本

一个 Alpine 容器干三件事：**把 NAS 上的媒体变成公网直链、把当前地址自动告诉前端、开机自己恢复**。

```
NAS 文件 ──┬─ 原图原片 → 共享文件夹/Photos/        （给 UGOS 相册应用，只读不改）
           └─ 暂存区   → 照片视频/csy/            （容器只读挂载）
                            │
                     pub_img.py / pub_vid.sh
                            ↓
                     album-pub/img、/video       （压缩去元信息后的发布版）
                            │
                     mkindex.py → index.json
                            ↓
                     Caddy :8443 → cloudflared → https://xxx.trycloudflare.com
                            ↓
                     boot.sh 抓域名 → pub_gh.sh 推 GitHub base.json
                            ↓
                     GitHub Pages 页面读 base.json + index.json → 直链加载
```

## 文件与执行顺序

| 顺序 | 文件 | 谁调用 | 作用 |
|---|---|---|---|
| 1 | `pub_img.py` | 手动 / 容器内 python3 | 源目录 → `img/*.jpg` + `img_index.json`（六步处理，顺序不能调） |
| 2 | `pub_vid.sh` | 手动 / 容器内 sh | `*.MOV` → `video/*.mp4`，HLG HDR 转 BT.709 SDR |
| 3 | `mkindex.py` | 手动 / 容器内 python3 | 合并上两步产出 → `index.json`（站点读的就是它） |
| 4 | `Caddyfile` | `boot.sh` 拷到 `/etc/caddy/` | 静态服务 + CORS + index.json 不缓存 |
| 5 | `boot.sh` | 容器 `command` | 起 Caddy → 起 cloudflared → 抓域名 → 写本地 base.json → 调 pub_gh.sh |
| 6 | `pub_gh.sh` | `boot.sh` | 把域名 PUT 到仓库根 `base.json`（GitHub Contents API） |

## 容器里的路径约定

| 宿主机 | 容器内 | 权限 |
|---|---|---|
| `共享文件夹/照片视频/csy` | `/srv/csy` | 只读 |
| `共享文件夹/照片视频/album-pub` | `/srv/pub` | 可写 |
| `共享文件夹/Photos` | `/srv/photos` | 可写（本链路不写，留给相册应用） |
| `共享文件夹/照片视频/album-pub/../ts-state` | `/var/lib/tailscale` | 可写，存 cloudflared、Caddyfile、boot.sh、`.gh_token` |

## 一次性准备

```sh
# 容器内
mkdir -p /srv/pub
pip install --no-cache-dir pillow     # Alpine 用 apk add py3-pillow 更省事
apk add --no-cache ffmpeg python3 py3-pillow

# 把 GitHub token 落到 ts-state（不要提交进仓库）
printf '%s' 'ghp_xxx' > /var/lib/tailscale/.gh_token && chmod 600 /var/lib/tailscale/.gh_token
```

## 日常发布新照片

```sh
python3 /var/lib/tailscale/pub_img.py /srv/csy /srv/pub
sh      /var/lib/tailscale/pub_vid.sh
python3 /var/lib/tailscale/mkindex.py
```

`index.json` 更新后刷新页面即可，不需要重启容器、不需要重新推送 GitHub（`base.json` 只在隧道域名变化时才需要更新）。

## 已知限制

- `trycloudflare.com` 免费隧道**域名不固定**，容器重启就变。这是免费方案的代价；要固定域名只能上 named tunnel（需要域名 + Cloudflare 账号）。
- Tailscale Funnel 的备选方案实测 **16 KB/s**（走境外 DERP 中继），看照片都卡，已弃用。
- cloudflared 免费隧道实测 **2.4 MB/s**，够用。
