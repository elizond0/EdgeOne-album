#!/bin/sh
# setup-nas.sh —— NAS 侧一条命令跑完「缩略图 → 清单 → 地址同步」
#
# 什么时候用：
#   · 第一次把相册搬上 NAS
#   · 往 /srv/csy 放了一批新照片之后
#   · 发现首页照片加载慢（说明缩略图还没生成）
#
# 做三件事，任何一步失败都只警告不中断，最后汇总：
#   1. mkthumb.py  原图 → img/t/ 缩略图（增量，已生成的跳过）
#   2. mkindex.py  重建 index.json（带上缩略图字段）
#   3. base-sync.sh 核对隧道地址，变了就推 GitHub
#
# 用法：
#   sh setup-nas.sh              # 增量
#   sh setup-nas.sh --full       # 缩略图全量重建（改了 --edge 参数后用）
#   sh setup-nas.sh --no-publish # 只在本机生成，不动 GitHub
#
# 注意：如果 /srv/pub/img 里还没有原图，先跑 pub_img.py。

P=${ALBUM_HOME:-/var/lib/tailscale}
FULL=""
PUBLISH=1

for a in "$@"; do
  case "$a" in
    --full) FULL="--force --clean" ;;
    --no-publish) PUBLISH=0 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
  esac
done

say() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# 依赖：Alpine 用 apk，别的发行版自己装
if ! python3 -c "import PIL" 2>/dev/null; then
  say "安装 python3 + Pillow"
  apk add --no-cache python3 py3-pillow >/dev/null 2>&1 || \
    pip3 install --no-cache-dir pillow >/dev/null 2>&1 || \
    echo "  ⚠ 依赖装不上，缩略图会失败"
fi

say "1/3 生成缩略图（长边 720）"
python3 "$P/mkthumb.py" /srv/pub $FULL || echo "  ⚠ 缩略图有失败项，见上方 ERR"

say "2/3 重建 index.json"
python3 "$P/mkindex.py" || echo "  ⚠ 清单生成失败"

if [ "$PUBLISH" = "1" ]; then
  say "3/3 同步隧道地址"
  sh "$P/base-sync.sh" || echo "  ⚠ 地址同步未成功，5 分钟内会自动重试"
else
  say "3/3 跳过地址同步（--no-publish）"
fi

say "完成。刷新页面即可看到效果。"
