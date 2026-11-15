#!/bin/sh
# bootstrap-nas.sh —— 把仓库里最新的运维脚本同步到 NAS，然后跑一遍 setup
#
# 为什么需要它：
#   脚本改了以后，NAS 上那份还是旧的。手动 scp 一次两个文件很烦，而且容易忘。
#   这条命令永远拿 main 分支的最新版，覆盖到脚本家目录，再执行。
#
# 用法（在 NAS 容器终端里）：
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/bootstrap-nas.sh)"
#
#   只同步不执行：加 --no-run
#   换仓库分支：REPO_BRANCH=dev sh bootstrap-nas.sh

P=${ALBUM_HOME:-/var/lib/tailscale}
# 国内直连 raw.githubusercontent.com 经常只是「挂着不回」。与其每个文件都等一次超时
# （8 个文件 × 6 秒 = 48 秒），不如先探一个探测请求，把快的源排到前面。
RAW_GH="https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts"
RAW_JS="https://cdn.jsdelivr.net/gh/elizond0/album@main/deploy-scripts"
# jsDelivr 对 @main 有缓存（几小时）。急用最新版就直接改 NAS 上那份，别指望镜像。
RAW_LIST="${ALBUM_RAW:-$RAW_GH $RAW_JS}"
RUN=1
[ "$1" = "--no-run" ] && RUN=0

FILES="boot.sh setup-nas.sh base-sync.sh mkthumb.py mkindex.py pub_img.py pub_vid.sh Caddyfile"

mkdir -p "$P"
say() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# 探测哪个源快，把它排到前面
if curl -fsS --connect-timeout 5 --max-time 10 -o /dev/null "$RAW_GH/Caddyfile" 2>/dev/null; then
  RAW_LIST="${ALBUM_RAW:-$RAW_GH $RAW_JS}"
  say "源：GitHub raw（直连可用）"
else
  RAW_LIST="${ALBUM_RAW:-$RAW_JS $RAW_GH}"
  say "源：jsDelivr 镜像（raw 直连超时）"
fi

# 依次试每个源，拿到就算
fetch() {
  for base in $RAW_LIST; do
    if curl -fsSL --connect-timeout 6 --max-time 15 -o "$2" "$base/$1" 2>/dev/null; then
      # GitHub 的 404 页面也会返回 200 的情况，挡一下
      head -c 20 "$2" | grep -q '404: Not Found' && continue
      return 0
    fi
  done
  return 1
}

say "同步脚本 → $P"
fail=0
for f in $FILES; do
  if fetch "$f" "$P/$f.new"; then
    mv "$P/$f.new" "$P/$f"
    echo "  ✓ $f"
  else
    echo "  ✗ $f 所有源都失败"
    rm -f "$P/$f.new"
    fail=1
  fi
done

chmod +x "$P"/*.sh 2>/dev/null

if [ "$fail" = "1" ]; then
  say "有文件没同步成功，先别继续执行"
  exit 1
fi

say "脚本已更新到最新"
ls -l "$P"/*.sh "$P"/*.py 2>/dev/null | awk '{print "  " $NF}'

[ "$RUN" = "0" ] && exit 0

say "接下来跑 setup-nas.sh（缩略图 + 清单 + 地址）"
exec sh "$P/setup-nas.sh"
