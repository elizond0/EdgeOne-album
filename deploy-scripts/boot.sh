#!/bin/sh
# album-node 引导脚本：Caddy 静态服务 + Cloudflare 隧道 + 地址自发布（本地 base.json + GitHub）
P=/var/lib/tailscale
apk add --no-cache caddy curl >/dev/null 2>&1
mkdir -p /var/run/tailscale /etc/caddy /srv/pub /srv/photos
cp $P/Caddyfile /etc/caddy/Caddyfile
caddy run --config /etc/caddy/Caddyfile >$P/caddy.log 2>&1 &
sleep 3
chmod +x $P/cloudflared
$P/cloudflared tunnel --url http://127.0.0.1:8443 --no-autoupdate >$P/cf.log 2>&1 &
U=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  U=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' $P/cf.log | head -1)
  if [ -n "$U" ]; then break; fi
  sleep 5
done
if [ -n "$U" ]; then
  T=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"base":"%s","updated":"%s"}\n' "$U" "$T" > /srv/pub/base.json
  echo "BASE=$U"
  sh $P/pub_gh.sh "$U"
else
  echo "BASE_EMPTY"
fi
echo BOOT_DONE
wait
