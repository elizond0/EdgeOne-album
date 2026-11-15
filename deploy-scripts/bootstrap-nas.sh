#!/bin/sh
# bootstrap-nas.sh —— 把仓库里最新的运维脚本同步到 NAS，然后跑一遍 setup
#
# 为什么需要它：
#   脚本改了以后，NAS 上那份还是旧的。手动 scp 一次两个文件很烦，而且容易忘。
#   这条命令永远拿 main 分支的最新版，覆盖到脚本家目录，再执行。
#
# 用法（在 NAS 容器终端里）：
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/elizond0/EdgeOne-album/main/deploy-scripts/bootstrap-nas.sh)"
#
#   只同步不执行：加 --no-run
#   换仓库分支：REPO_BRANCH=dev sh bootstrap-nas.sh

P=${ALBUM_HOME:-/var/lib/tailscale}
RAW=${ALBUM_RAW:-https://raw.githubusercontent.com/elizond0/EdgeOne-album/main/deploy-scripts}
RUN=1
[ "$1" = "--no-run" ] && RUN=0

FILES="boot.sh setup-nas.sh base-sync.sh mkthumb.py mkindex.py pub_img.py pub_vid.sh Caddyfile"

mkdir -p "$P"
say() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

say "同步脚本 → $P"
fail=0
for f in $FILES; do
  if curl -fsSL --max-time 30 -o "$P/$f.new" "$RAW/$f"; then
    # 先确认下下来的不是 GitHub 的 404 页面
    if head -c 20 "$P/$f.new" | grep -q '404: Not Found'; then
      echo "  ✗ $f 不存在（分支或路径不对）"
      rm -f "$P/$f.new"
      fail=1
    else
      mv "$P/$f.new" "$P/$f"
      echo "  ✓ $f"
    fi
  else
    echo "  ✗ $f 下载失败"
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
