#!/bin/sh
# nas-setup.sh —— 在 album-node 容器内一次跑完所有「发布侧媒体加工」
#
# 背景：容器里原先只有 pub_img.py / pub_vid.sh / mkindex.py / boot.sh，
#       mkthumb.py 和 base-sync.sh 从没部署上去，所以：
#         · 562 张照片没有缩略图，网格只能拉 2048px 压缩原图
#         · 16 个视频是手机原码（286 MB），首页 3 个就吃掉 67 MB
#         · 隧道地址变了没人追平 base.json（base-sync 进程根本不在）
#       这个脚本把这几件事一次补齐，并把 base-sync 挂成常驻。
#
# 数据来源（实测）：/srv/photos 里既有照片也有视频 —— 579 项 = 562 张图 + 16 个视频 + #recycle。
#       /srv/csy 是同一批文件的只读暂存副本。所以照片和视频都从 /srv/photos 进发布链。
#
# 用法（在容器网页终端里）：
#   wget -q -O /tmp/nas-setup.sh "https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts/nas-setup.sh?x=$(date +%s)" \
#     && sh /tmp/nas-setup.sh > /srv/pub/wb_setup.log 2>&1 &
#   然后浏览器打开 https://<隧道>/wb_setup.log 看进度
#
# 可重入：已生成的压缩图 / 缩略图 / 已转码的视频 / 已抽的封面都会跳过。

set -u
# 网页终端关掉后，后台脚本若还连着 pty，子进程 ffmpeg 会因为读 stdin 吃 SIGTTIN
# 被整个停住：ps 里进程还在、CPU 时间 0、输出文件迟迟不出现。把 stdin 彻底摘干净，
# 否则「终端一关脚本看着还活着，其实卡在第一个视频」这种问题很难查。
exec </dev/null
P=/var/lib/tailscale
OUT=/srv/pub
SRC=${SRC_PHOTOS:-/srv/photos}
RAW=https://raw.githubusercontent.com/elizond0/album/main/deploy-scripts
# GitHub Pages 发布的是同一个 main 分支，CDN 通常比 raw 稳，作为备用源
PAGES_RAW=https://elizond0.github.io/album/deploy-scripts
LOG=/srv/pub/wb_setup.log

say() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# 下载单个脚本：raw 优先、Pages 兜底，各试 2 次；一律先写 .tmp 再 mv。
# busybox wget -O 失败会留下 0 字节文件，那样会把本地已有好版本毁掉，必须避开。
fetch() {
  f=$1
  for src in "$RAW" "$PAGES_RAW"; do
    for try in 1 2; do
      if wget -q -T 20 -O "$P/$f.tmp" "$src/$f?x=$(date +%s)$try" 2>/dev/null && [ -s "$P/$f.tmp" ]; then
        mv "$P/$f.tmp" "$P/$f"
        say "  下载 $f OK ($(wc -c < "$P/$f") bytes)"
        return 0
      fi
    done
  done
  rm -f "$P/$f.tmp"
  if [ -s "$P/$f" ]; then
    say "  下载 $f 失败，沿用本地已有版本"
    return 0
  fi
  say "  下载 $f 失败且本地没有，无法继续"
  return 1
}

# ── 0. 前置 ────────────────────────────────────────────────────────────────
say "=== 0/8 检查依赖 ==="
for t in python3 ffmpeg ffprobe wget; do
  command -v "$t" >/dev/null 2>&1 || { say "缺少 $t，先跑 apk add --no-cache python3 py3-pillow ffmpeg"; exit 1; }
done
python3 -c 'import PIL' 2>/dev/null || { say "缺少 Pillow"; exit 1; }
say "OK python3 / ffmpeg / Pillow 都在；源目录 $SRC"

# ── 1. 部署脚本 ────────────────────────────────────────────────────────────
say "=== 1/8 部署 pub_img.py / mkthumb.py / base-sync.sh / mkindex.py ==="
mkdir -p "$P"
for f in pub_img.py mkthumb.py base-sync.sh mkindex.py pub_vid.sh boot.sh; do
  fetch "$f" || exit 1
done
chmod +x "$P/base-sync.sh" "$P/pub_vid.sh" 2>/dev/null || true
# 版本校验：mkindex.py 必须带 t / p 字段，否则重建出来的 index.json
# 还是没有缩略图和封面，前端只能继续拉 2048px 原图、视频继续没有 poster。
if ! grep -q '"p": ' "$P/mkindex.py" || ! grep -q '"t": ' "$P/mkindex.py"; then
  say "⚠ mkindex.py 版本过旧（缺 t/p 字段），请检查下载源"
fi
# pub_img.py 必须支持 --skip-existing 和孤儿保留，否则每次新增一张照片都要全量重编码
if ! grep -q 'skip_existing' "$P/pub_img.py"; then
  say "⚠ pub_img.py 版本过旧（不支持 --skip-existing），本轮会全量重编码，较慢"
fi

# ── 2. 源目录文件名统一小写 ────────────────────────────────────────────────
# 只改目录项、文件内容一个字节都不动；已有同名小写文件时加 _1 后缀避让，绝不覆盖。
say "=== 2/8 统一 $SRC 文件名小写 ==="
if [ -d "$SRC" ]; then
  SRC="$SRC" python3 - <<'PY'
import os
d = os.environ["SRC"]
n = skip = conf = 0
for b in sorted(os.listdir(d)):
    p = os.path.join(d, b)
    if not os.path.isfile(p):
        continue
    low = b.lower()
    if low == b:
        skip += 1
        continue
    t = os.path.join(d, low)
    if os.path.exists(t):
        stem, ext = os.path.splitext(low)
        i = 1
        while os.path.exists(os.path.join(d, "%s_%d%s" % (stem, i, ext))):
            i += 1
        t = os.path.join(d, "%s_%d%s" % (stem, i, ext))
        conf += 1
    os.rename(p, t)
    n += 1
print("  重命名 %d 个 / 已是小写 %d 个 / 冲突避让 %d 个" % (n, skip, conf))
PY
  say "  剩余含大写的文件名：$(ls -1 "$SRC" 2>/dev/null | grep -c '[A-Z]')"
else
  say "  $SRC 不存在，跳过"
fi

# ── 3. 公网压缩图（这一步以前漏了，新照片根本进不了站点）─────────────────
# 规则：先读 EXIF 日期 → 烘焙方向 → RGB → 长边 2048 → q85 progressive 且不写 EXIF。
# --skip-existing：输出比源新就跳过，加一张照片只处理那一张。
say "=== 3/8 生成公网压缩图（长边 2048，q85，去元信息）==="
if [ -d "$SRC" ]; then
  python3 "$P/pub_img.py" "$SRC" "$OUT" --skip-existing 2>&1 | tail -6
  say "公网压缩图：$(ls "$OUT/img"/*.jpg 2>/dev/null | wc -l) 张"
else
  say "⚠ 源目录不存在，跳过（/srv/pub/img 保持原样）"
fi

# ── 4. 视频：新片入队 + 备份原片 + 统一小写 + 转码 + 抽首帧封面 ────────────
say "=== 4/8 处理视频 ==="
ORIG=$P/orig_video
mkdir -p "$ORIG" "$OUT/video/poster"

# 4a. 把历史上遗留在 /srv/pub/video 里的**原片**挪进备份目录（旧流程产物，通常是空的）。
#     判据必须用「体积」而不是「有没有这个文件」：video/ 里现在躺的是转码成品，
#     同名成品明显比原片小；无脑迁移会把成品搬进 orig_video，接着 4c 发现 video/
#     空了 → 16 个视频全量重转一遍（实测白白多跑 2 分钟）。
#     兜底规则：同名文件在两边都在、且大小一样时按成品处理（保留，不迁移）。
for f in "$OUT"/video/*.mp4 "$OUT"/video/*.MP4 "$OUT"/video/*.mov "$OUT"/video/*.MOV; do
  [ -f "$f" ] || continue
  n=$(basename "$f")
  low=$(printf '%s' "$n" | tr 'A-Z' 'a-z')
  low=$(printf '%s' "$low" | sed 's/\.mov$/.mp4/')
  if [ ! -f "$ORIG/$low" ]; then
    mv "$f" "$ORIG/$low" && say "  迁移 $n -> $low"
  elif [ "$(stat -c %s "$f")" -lt "$(stat -c %s "$ORIG/$low")" ]; then
    say "  清理残留原片 $n（已有备份，video/ 里这个是干扰项）"
    rm -f "$f"
  fi
done

# 4b. 再从源目录把新增视频复制进来（只复制，源文件一个字节不改）。
#     判据只看文件名是否已在 orig_video，大小不同视为换了片子 → 覆盖重转。
if [ -d "$SRC" ]; then
  for f in "$SRC"/*.mp4 "$SRC"/*.MP4 "$SRC"/*.mov "$SRC"/*.MOV; do
    [ -f "$f" ] || continue
    low=$(basename "$f" | tr 'A-Z' 'a-z' | sed 's/\.mov$/.mp4/')
    if [ ! -f "$ORIG/$low" ]; then
      cp "$f" "$ORIG/$low" && say "  入队 $(basename "$f")"
    fi
  done
fi
say "原片备份数：$(ls "$ORIG" 2>/dev/null | wc -l)"

# 4c. 逐个转码 + 抽封面。已存在则跳过（可重入）。
i=0
for f in "$ORIG"/*.mp4 "$ORIG"/*.mov "$ORIG"/*.MOV; do
  [ -f "$f" ] || continue
  i=$((i + 1))
  base=$(basename "$f")
  n=$(printf '%s' "${base%.*}" | tr 'A-Z' 'a-z')
  dst="$OUT/video/$n.mp4"
  poster="$OUT/video/poster/$n.jpg"
  if [ -f "$dst" ] && [ -f "$poster" ]; then say "  [$i] SKIP $n"; continue; fi
  say "  [$i] START $n ($(du -h "$f" | cut -f1))"
  if [ ! -f "$dst" ]; then
    # force_divisible_by=2：H.264 要求宽高为偶数，等比缩放偶尔会算出奇数边长
    ffmpeg -y -v error -i "$f" \
      -vf "scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p" \
      -c:v libx264 -crf 23 -preset veryfast \
      -c:a aac -b:a 96k \
      -movflags +faststart -map_metadata -1 -map_chapters -1 \
      "$dst" && say "       转码完成 $(du -h "$dst" | cut -f1)"
  fi
  if [ ! -f "$poster" ]; then
    ffmpeg -y -v error -ss 1 -i "$f" -frames:v 1 \
      -vf "scale=640:640:force_original_aspect_ratio=decrease" \
      -q:v 5 "$poster" && say "       封面完成"
  fi
done
say "转码后 video/ 共 $(du -sh "$OUT/video" | cut -f1)，原片 $(du -sh "$ORIG" | cut -f1)"

# ── 5. 缩略图 ──────────────────────────────────────────────────────────────
# 必须排在 3 之后：mkthumb 读的是 /srv/pub/img（压缩图），不是源目录。
say "=== 5/8 生成缩略图（长边 720，q78）==="
python3 "$P/mkthumb.py" "$OUT" --edge 720 --quality 78 2>&1 | tail -8
say "缩略图数量：$(ls "$OUT/img/t" 2>/dev/null | wc -l)"

# ── 6. 重建 index.json（带缩略图 t 与封面 p）──────────────────────────────
say "=== 6/8 重建 index.json ==="
python3 "$P/mkindex.py" 2>&1 | tail -5
say "index.json 里带缩略图的条目：$(grep -c '"t": "img/t/' "$OUT/index.json" 2>/dev/null || echo 0)"
say "index.json 里带封面的条目：$(grep -c '"p": "video/poster/' "$OUT/index.json" 2>/dev/null || echo 0)"

# ── 7. 启动域名自愈常驻进程 ───────────────────────────────────────────────
say "=== 7/8 启动 base-sync 常驻（5 分钟一次）==="
if [ -f "$P/.gh_token" ]; then
  # 已有 watcher 就别再拉一个：两个进程同时推 base.json 会抢同一个 sha。
  # 用 busybox 兼容的 `ps | grep`，不用 `ps -o pid,args`（Alpine 上不支持）。
  if ps | grep -q '[b]ase-sync.sh --watch'; then
    say "  已有 watcher 在跑，跳过重复启动"
  else
    (sleep 2; sh "$P/base-sync.sh" --watch 300) >>"$P/base-sync.log" 2>&1 &
    say "  已启动；boot.sh 里已有同样的挂载，容器重启后会自动恢复"
  fi
  sh "$P/base-sync.sh" >>"$P/base-sync.log" 2>&1
  say "  首轮同步结果见 $P/base-sync.log"
else
  say "  ⚠ 没有 $P/.gh_token，跳过（base.json 仍需手工同步）"
fi

# ── 8. 收尾 ───────────────────────────────────────────────────────────────
say "=== 8/8 完成 ==="
say "压缩图 $(ls "$OUT/img"/*.jpg 2>/dev/null | wc -l) 张 / 缩略图 $(ls "$OUT/img/t"/*.jpg 2>/dev/null | wc -l) 张"
say "视频 $(ls "$OUT/video"/*.mp4 2>/dev/null | wc -l) 个 / 封面 $(ls "$OUT/video/poster" 2>/dev/null | wc -l) 张"
say "ALL_DONE"
