#!/bin/sh
# album-node 引导脚本（容器 ENTRYPOINT / rc.local 都跑这个）
#
# 干四件事：
#   1. Caddy 起在 8443，把 /srv/pub 静态发出去（带 CORS，给 GitHub Pages 跨域用）
#   2. album-push.py 起在 127.0.0.1:8787，给 Caddy 的 /api/* 兜后台写入口
#   3. cloudflared 快速隧道把 8443 暴露到公网
#   4. base-sync.sh 常驻，盯着隧道地址，变了就推 GitHub 的 base.json
#
# 第 4 步为什么要「常驻」而不是「开机跑一次」：
#   快速隧道断线重连会换域名。只跑一次的话，NAS 中途抖一下就永久失联，
#   而站点上没有任何线索说明是地址变了。常驻 5 分钟一次，最多 5 分钟自愈。
P=${ALBUM_HOME:-/var/lib/tailscale}

# ffmpeg 一定要装上：视频转码和首帧封面都靠它。之前漏了这一项，
# 容器起来后 python3 / ffmpeg 都不存在，缩略图和转码脚本自然跑不动。
apk add --no-cache caddy curl python3 py3-pillow ffmpeg >/dev/null 2>&1
mkdir -p /var/run/tailscale /etc/caddy /srv/pub /srv/photos /srv/pub/video/poster

cp $P/Caddyfile /etc/caddy/Caddyfile
caddy run --config /etc/caddy/Caddyfile >$P/caddy.log 2>&1 &
sleep 3

# 后台写入口：只监听 127.0.0.1，公网只能经 Caddy 的 /api/* 进来。
# 没配口令（push-secret 不存在）也照起，健康检查会报 key_set=false，方便排查。
if [ -f $P/album-push.py ]; then
  python3 $P/album-push.py >>$P/push.log 2>&1 &
fi

chmod +x $P/cloudflared 2>/dev/null
$P/cloudflared tunnel --url http://127.0.0.1:8443 --no-autoupdate >$P/cf.log 2>&1 &

# 先给隧道 20 秒把域名和 DNS 备好，再让 sync 去读日志，少打几轮失败日志
(sleep 20; sh $P/base-sync.sh --watch 300) &

echo "BOOT_OK caddy=:8443 push=:8787 cloudflared=starting base-sync=armed"
wait
