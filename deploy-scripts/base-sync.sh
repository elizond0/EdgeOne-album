#!/bin/sh
# base-sync.sh —— 把 NAS 当前的隧道地址同步到 GitHub 仓库的 base.json
#
# 解决什么：
#   cloudflared 的快速隧道每次重连都会换一个新域名。域名一换，GitHub Pages 上的
#   base.json 就指向一个不存在的地址，整站照片全灭。这个脚本负责「追平」：
#   发现隧道地址变了就写回仓库，没变就什么都不做（不产生空提交）。
#
# 什么时候跑：
#   1. NAS 开机 / 容器启动时跑一次
#   2. 之后每 5 分钟跑一次（--watch），覆盖「中途断线重连」的情况
#   3. 手动：sh base-sync.sh --force
#
# 为什么这么啰嗦：
#   quick tunnel 从「进程起来」到「域名真的能访问」中间有几十秒空窗，拿到域名就推
#   会把站点指向一个还打不开的地址。所以推送前必须先 curl 一次 index.json 拿到 200。
#   推送后 GitHub Pages 还有几十秒构建，所以推完还要回读校验，不能发完就不管。
#
# 用法：
#   sh base-sync.sh                 # 同步一次
#   sh base-sync.sh --force         # 地址没变也重推（内容相同 GitHub 会返回 200 并有新 commit）
#   sh base-sync.sh --watch 300     # 每 300 秒检查一次，前台常驻
#   sh base-sync.sh --url https://x.trycloudflare.com    # 手动指定，不读日志
#
# 依赖：curl、base64（busybox 自带）

P=${ALBUM_HOME:-/var/lib/tailscale}
REPO=${ALBUM_REPO:-elizond0/EdgeOne-album}
PAGES=${ALBUM_PAGES:-https://elizond0.github.io/EdgeOne-album}
TOKF=$P/.gh_token
LOG=$P/base-sync.log
API="https://api.github.com/repos/$REPO/contents/base.json"

FORCE=""
WATCH=""
URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --watch) WATCH="$2"; shift ;;
    --url) URL="$2"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
  esac
  shift
done

# 本地副本：Caddy 的 /srv/pub/base.json，NAS 上别的脚本可能读它。
# 目录不存在（比如在开发机上试跑）就跳过，不算错。
write_local() {
  [ -d /srv/pub ] || return 0
  printf '{"base":"%s","updated":"%s"}\n' "$1" "$2" > /srv/pub/base.json
}

log() {
  printf '%s %s\n' "$(date -u '+%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

# 日志别无限长：超过 2000 行砍掉前半
trim_log() {
  [ -f "$LOG" ] || return 0
  n=$(wc -l < "$LOG" 2>/dev/null || echo 0)
  if [ "$n" -gt 2000 ]; then
    tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

# 从 cloudflared 日志里取最后一个出现的隧道地址
tunnel_url() {
  [ -n "$URL" ] && { echo "$URL"; return; }
  [ -f "$P/cf.log" ] || return
  grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$P/cf.log" 2>/dev/null | tail -1
}

# 隧道不止要「有地址」，还要「真的能打开」——quick tunnel 建立后 DNS 有几十秒空窗
tunnel_ready() {
  u="$1"
  i=0
  while [ $i -lt 4 ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u/index.json" 2>/dev/null)
    if [ "$code" = "200" ]; then return 0; fi
    i=$((i + 1))
    log "  隧道未就绪（HTTP ${code:-超时}），10s 后重试 $i/4"
    sleep 10
  done
  return 1
}

sync_once() {
  TOK=$(cat "$TOKF" 2>/dev/null | tr -d ' \r\n')
  if [ -z "$TOK" ]; then
    log "SKIP 没有 token（$TOKF）"
    return 1
  fi

  U=$(tunnel_url)
  if [ -z "$U" ]; then
    log "SKIP 日志里没有隧道地址（cloudflared 可能还没起来）"
    return 1
  fi

  if ! tunnel_ready "$U"; then
    log "FAIL 隧道 $U 连续 4 次打不开，本轮放弃"
    return 1
  fi

  # 线上当前值（走 Pages，带时间戳绕 CDN）+ 文件 sha（更新时 GitHub 要求带上）
  RESP=$(curl -s --max-time 25 -H "Authorization: token $TOK" \
         -H "Accept: application/vnd.github+json" "$API" 2>/dev/null)
  RAW=$(curl -s --max-time 25 "$PAGES/base.json?x=$(date +%s)" 2>/dev/null)
  OLD=$(printf '%s' "$RAW" | sed -n 's/.*"base"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  SHA=$(printf '%s' "$RESP" | grep -o '"sha"[[:space:]]*:[[:space:]]*"[a-f0-9]\{40\}"' | head -1 \
        | sed 's/.*"\([a-f0-9]\{40\}\)".*/\1/')

  if [ "$OLD" = "$U" ] && [ -z "$FORCE" ]; then
    log "OK 地址未变（$U），无需推送"
    write_local "$U" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    return 0
  fi

  T=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  JSON=$(printf '{\n  "base": "%s",\n  "updated": "%s"\n}\n' "$U" "$T")
  B64=$(printf '%s' "$JSON" | base64 | tr -d '\n')

  if [ -n "$SHA" ]; then
    BODY=$(printf '{"message":"chore(base): 隧道地址更新 %s","content":"%s","sha":"%s"}' "$T" "$B64" "$SHA")
  else
    BODY=$(printf '{"message":"chore(base): 创建 base.json %s","content":"%s"}' "$T" "$B64")
  fi

  CODE=$(curl -s -o "$P/.gh_put.log" -w '%{http_code}' --max-time 30 -X PUT \
    -H "Authorization: token $TOK" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -d "$BODY" "$API" 2>/dev/null)

  if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
    log "FAIL 推送失败 HTTP $CODE（详情 $P/.gh_put.log）"
    return 1
  fi
  log "PUSH 已提交：$OLD → $U"

  write_local "$U" "$T"

  # GitHub Pages 还要构建几十秒。回读校验，别「发出去就当成功」。
  i=0
  while [ $i -lt 18 ]; do
    sleep 5
    NOW=$(curl -s --max-time 12 "$PAGES/base.json?x=$(date +%s)" 2>/dev/null \
          | sed -n 's/.*"base"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    if [ "$NOW" = "$U" ]; then
      log "LIVE 线上已生效（等待 $((i * 5 + 5))s）"
      return 0
    fi
    i=$((i + 1))
  done
  log "WARN 已提交但 90s 内线上仍未生效，Pages 可能还在构建；下一轮会再核对一次"
  return 0
}

if [ -n "$WATCH" ]; then
  log "== base-sync 常驻启动，间隔 ${WATCH}s =="
  while :; do
    sync_once
    trim_log
    sleep "$WATCH"
  done
else
  sync_once
  trim_log
fi
