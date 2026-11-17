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
REPO=${ALBUM_REPO:-elizond0/album}
PAGES=${ALBUM_PAGES:-https://elizond0.github.io/album}
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

# 从 cloudflared 日志里取隧道地址。
# 2026-11-17 踩坑：日志里除了真正的隧道域名，还有 cloudflared 请求接口用的
# https://api.trycloudflare.com —— 用宽松正则 + tail -1 会抓到后者，把整站指到
# Cloudflare 的 API 上（HTTP 405，照片全灭）。所以：
#   1) 优先取「Your quick Tunnel has been created」后面那几行，那是官方公布的地址
#   2) 兜底时要求子域名 ≥ 8 个字符，api（3 个）这类接口域名自然被排除
extract_url() {
  [ -f "$P/cf.log" ] || return
  u=$(grep -A3 'Your quick Tunnel has been created' "$P/cf.log" 2>/dev/null \
      | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
  [ -z "$u" ] && u=$(grep -oE 'https://[a-z0-9-]{8,}\.trycloudflare\.com' "$P/cf.log" 2>/dev/null | tail -1)
  printf '%s' "$u"
}

tunnel_url() {
  [ -n "$URL" ] && { echo "$URL"; return; }
  extract_url
}

# 隧道不止要「有地址」，还要「真的能打开」——quick tunnel 建立后 DNS 有几十秒空窗
# 预算 8 次 × 15s = 2 分钟：换来的是「不因为 DNS 还没传播就去换新隧道」。
tunnel_ready() {
  u="$1"
  i=0
  while [ $i -lt 8 ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u/index.json" 2>/dev/null)
    if [ "$code" = "200" ]; then return 0; fi
    i=$((i + 1))
    log "  隧道未就绪（HTTP ${code:-超时}），15s 后重试 $i/8"
    sleep 15
  done
  return 1
}

# ---------------------------------------------------------------------------
# 隧道自愈
# ---------------------------------------------------------------------------
# 2026-11-17 事故：Cloudflare 把这条 quick tunnel 回收了（日志里
# "Unauthorized: Tunnel not found"），但 cloudflared 进程还活着、cf.log 里
# 还留着早上 07:36 的旧域名。于是 base-sync 每 5 分钟读到同一个已失效的域名、
# curl 打不开、记 FAIL 就走了 —— 它能「追平地址变化」，却追不平「隧道已死」。
# 结果站点所有照片挂了一小时，直到人肉发现。
#
# 所以：地址同步之前先确认隧道真的活着，死了就换一条新的。
# 判据只有一条 —— 从公网 curl 得到 200。进程在不在、日志写了什么，都只是线索。

# 单实例锁：watch 常驻和手动执行不能同时动隧道。
# 2026-11-17 实测踩过：watch 每 300s 一轮，手动那次也在跑，两边都判定「隧道打不开」，
# 于是一个接一个地换隧道，域名像抽奖。锁用 mkdir 的原子性，pid 文件辅助识别陈旧锁。
LOCK="$P/.base-sync.lock"
lock_acquire() {
  if mkdir "$LOCK" 2>/dev/null; then
    echo $$ > "$LOCK/pid" 2>/dev/null
    return 0
  fi
  LP=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -z "$LP" ] || ! kill -0 "$LP" 2>/dev/null; then
    rm -rf "$LOCK" 2>/dev/null
    if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid" 2>/dev/null; return 0; fi
  fi
  return 1
}
lock_release() { rm -rf "$LOCK" 2>/dev/null; }

# 新隧道建好后，等它真的能从公网打开。quick tunnel 的 DNS 传播常见 20~60s，
# 这段空窗里「打不开」是正常现象，不是故障——所以这里只等，不下判决。
wait_public() {
  u="$1"; budget="${2:-14}"
  i=0
  while [ $i -lt "$budget" ]; do
    sleep 5
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$u/index.json" 2>/dev/null)
    if [ "$code" = "200" ]; then log "READY $u（$((i * 5 + 5))s）"; return 0; fi
    i=$((i + 1))
  done
  log "WARN $u 等了 $((budget * 5))s 还打不开，交给下一轮"
  return 1
}

# 起一条新 quick tunnel，并把 cf.log 清空（否则旧域名会一直被 tail -1 读到）
start_tunnel() {
  OLD_PID=$(ps w 2>/dev/null | awk '/[c]loudflared tunnel/{print $1; exit}')
  [ -n "$OLD_PID" ] && { log "HEAL 停掉旧 cloudflared（pid $OLD_PID）"; kill "$OLD_PID" 2>/dev/null; sleep 2; }
  : > "$P/cf.log"
  nohup "$P/cloudflared" tunnel --url http://127.0.0.1:8443 --no-autoupdate >>"$P/cf.log" 2>&1 &
  date +%s > "$P/.tunnel_at" 2>/dev/null
  i=0
  while [ $i -lt 20 ]; do
    sleep 3
    NEW=$(extract_url)
    if [ -n "$NEW" ]; then
      log "HEAL 新隧道已建：$NEW"
      wait_public "$NEW" 14
      return 0
    fi
    i=$((i + 1))
  done
  log "HEAL 60s 内没拿到新域名，cloudflared 可能起不来（看 $P/cf.log）"
  return 1
}

# 隧道挂了就拉起来。--url 手填地址时不动（那是人在调试，别替他做决定）。
ensure_tunnel() {
  [ -n "$URL" ] && return 0
  [ -x "$P/cloudflared" ] || { log "SKIP 没有 $P/cloudflared"; return 1; }

  if ! lock_acquire; then
    log "SKIP 另一轮正在处理隧道，本轮不动"
    return 0
  fi

  # Caddy 本地这一层先看一眼：本地都不通，重启隧道是白忙
  LC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8443/index.json 2>/dev/null)
  if [ "$LC" != "200" ]; then
    log "WARN 本地 Caddy 返回 ${LC:-超时}（不是 200），隧道就算起来也没东西可发"
  fi

  PID=$(ps w 2>/dev/null | awk '/[c]loudflared tunnel/{print $1; exit}')
  if [ -z "$PID" ]; then
    log "HEAL cloudflared 进程不在"
    start_tunnel
    lock_release
    return $?
  fi

  U=$(tunnel_url)
  if [ -z "$U" ]; then
    log "HEAL cf.log 里没有隧道地址"
    start_tunnel
    lock_release
    return $?
  fi

  # 刚起的隧道还在 DNS 传播期。这时候判「打不开」就再换一条，只会连环换。
  AT=$(cat "$P/.tunnel_at" 2>/dev/null)
  NOW=$(date +%s)
  case "$AT" in
    ''|*[!0-9]*) : ;;
    *) if [ $((NOW - AT)) -lt 180 ]; then
         log "WAIT 隧道 $((NOW - AT))s 前刚建，180s 内不判死"
         lock_release
         return 0
       fi ;;
  esac

  # 三次探测，全失败才重启 —— 单次抖动不该换来一条新隧道
  i=0
  while [ $i -lt 3 ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$U/index.json" 2>/dev/null)
    [ "$code" = "200" ] && { lock_release; return 0; }
    i=$((i + 1))
    [ $i -lt 3 ] && sleep 5
  done

  if grep -q 'Tunnel not found' "$P/cf.log" 2>/dev/null; then
    log "HEAL 日志里有 Tunnel not found：这条隧道已被 Cloudflare 回收"
  else
    log "HEAL $U 连不上（HTTP ${code:-超时}）"
  fi
  start_tunnel
  lock_release
  return $?
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
    ensure_tunnel      # 先确认隧道活着，死了换新的；再谈地址同步
    sync_once
    trim_log
    sleep "$WATCH"
  done
else
  ensure_tunnel
  sync_once
  trim_log
fi
