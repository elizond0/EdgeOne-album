#!/bin/sh
# pub_gh.sh —— 把当前隧道地址推送到 GitHub 仓库根目录的 base.json
# 用法: sh pub_gh.sh "https://xxxx.trycloudflare.com"
P=/var/lib/tailscale
U="$1"
TOK=$(cat $P/.gh_token 2>/dev/null | tr -d ' \r\n')
REPO=elizond0/EdgeOne-album

if [ -z "$TOK" ]; then echo "GH_SKIP=no_token"; exit 0; fi
if [ -z "$U" ]; then echo "GH_SKIP=no_url"; exit 0; fi

API="https://api.github.com/repos/$REPO/contents/base.json"
T=$(date -u +%Y-%m-%dT%H:%M:%SZ)
JSON=$(printf '{\n  "base": "%s",\n  "updated": "%s"\n}\n' "$U" "$T")
B64=$(printf '%s' "$JSON" | base64 | tr -d '\n')

SHA=$(curl -s --max-time 20 -H "Authorization: token $TOK" \
      -H "Accept: application/vnd.github+json" "$API" \
      | tr ',' '\n' | grep '"sha"' | head -1 \
      | sed 's/.*"sha" *: *"\([a-f0-9]*\)".*/\1/')

if [ -n "$SHA" ]; then
  BODY=$(printf '{"message":"chore: update base.json (%s)","content":"%s","sha":"%s"}' "$T" "$B64" "$SHA")
else
  BODY=$(printf '{"message":"chore: create base.json (%s)","content":"%s"}' "$T" "$B64")
fi

CODE=$(curl -s -o $P/gh.log -w '%{http_code}' --max-time 30 -X PUT \
  -H "Authorization: token $TOK" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  -d "$BODY" "$API")

echo "GH_PUSH=$CODE SHA_BEFORE=${SHA:0:7}"
