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
# 数据来源（2026-11-17 实测）：共享文件夹/Photos/csy → 容器 /srv/csy（只读），
#       578 项 = 562 JPG/PNG + 16 MOV，全在**同一层**，没有子目录。
#       压缩图与视频的唯一源就是这个目录；/srv/photos 已从 compose 移除。
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
SRC=${SRC_PHOTOS:-/srv/csy}
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

# 源目录必须真切能用。空目录 / 不存在 / 只有回收站，一律立刻退出。
#
# 为什么要拦死：源目录挂错时后面每一步都「成功」——pub_img.py 处理 0 张、
# 视频入队 0 个、mkindex.py 照常重建清单，日志看着全绿，站点上的新照片却一张没进。
# 这种失败没有报错、没有红色，只能靠这一步主动判死。
if [ ! -d "$SRC" ]; then
  say "✗ 源目录不存在：$SRC"
  say "  检查容器挂载：mount | grep srv/csy —— 挂到共享文件夹 csy 子目录，只读"
  exit 1
fi
_media=$(ls -1 "$SRC" 2>/dev/null | grep -icE '\.(jpe?g|png|webp|bmp|tiff?|mov|mp4|heic)$')
say "  源目录 $SRC 里媒体文件 $_media 个"
if [ "$_media" -eq 0 ]; then
  say "✗ 源目录里一张图 / 一个视频都没有，拒绝继续（挂载很可能指错了目录）"
  exit 1
fi
# 兜底：只对比「源里有、pub 里没有」的压缩图，缺口过大说明源指错了。
# 阈值 50% 是保守值 —— 正常新增照片产生的缺口远小于这个比例。
if [ -d "$OUT/img" ]; then
  _pub=$(ls -1 "$OUT/img"/*.jpg 2>/dev/null | wc -l)
  if [ "$_pub" -gt 0 ] && [ "$_media" -lt $((_pub / 2)) ]; then
    say "✗ 源目录只有 $_media 个媒体文件，而 $OUT/img 已有 $_pub 张压缩图"
    say "  源目录多半挂错了（正常情况源数 ≥ 已发布数）。确认后如仍要继续：SRC_PHOTOS=... NAS_SETUP_FORCE=1 sh nas-setup.sh"
    [ "${NAS_SETUP_FORCE:-0}" = "1" ] || exit 1
  fi
fi

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
#
# 源目录是**只读挂载**（共享文件夹 csy 子目录 → /srv/csy:ro）。ro 下 os.rename 会
# 直接抛 EROFS，脚本在第 2 步就挂掉 —— 这不是程序 bug，是设计如此：故意不让任何人
# 碰到原图。所以这里先探测可写性，只读就跳过本步（文件名小写化本来就只是美观，
# pub_img.py 输出时已经强制 stem.lower()+".jpg"，不改源名也不会 404）。
say "=== 2/8 统一 $SRC 文件名小写 ==="
# 可写性判据不能写成 `! : > 文件`：只读文件系统下 sh 会打 Write Failure 并
# **直接 exit 1**，脚本在第 2 步就整体死掉（2026-11-16 在 NAS 上实跑踩到）。
# 改用 mount 表判 ro，失败也只是一个空串，不会带崩脚本。
_ro=$(mount 2>/dev/null | grep " on $SRC " | grep -c "(ro," 2>/dev/null || echo 0)
if [ ! -d "$SRC" ]; then
  say "  $SRC 不存在，跳过"
elif [ "$_ro" -gt 0 ]; then
  say "  $SRC 是只读挂载（ro），跳过改名。压缩图输出名由 pub_img.py 统一小写，不影响站点"
else
  # 兜底：ro 判断偶尔会因 mount 格式差异失效，用 python 试写一次并吞掉异常
  SRC="$SRC" python3 - <<'PYF'
import os, sys
d = os.environ["SRC"]
try:
    t = os.path.join(d, ".wbtest")
    open(t, "w").close(); os.remove(t)
except Exception as e:
    print("  只读或不可写（%s），跳过改名" % type(e).__name__)
    sys.exit(0)
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
PYF
  say "  剩余含大写的文件名：$(ls -1 "$SRC" 2>/dev/null | grep -c '[A-Z]')"
fi

# ── 3. 公网压缩图（这一步以前漏了，新照片根本进不了站点）─────────────────
# 规则：先读 EXIF 日期 → 烘焙方向 → RGB → 长边 2048 → q85 progressive 且不写 EXIF。
# --skip-existing：输出比源新就跳过，加一张照片只处理那一张。
say "=== 3/8 生成公网压缩图（长边 2048，q85，去元信息）==="
_pub_before=$(ls "$OUT/img"/*.jpg 2>/dev/null | wc -l)
python3 "$P/pub_img.py" "$SRC" "$OUT" --skip-existing 2>&1 | tail -6
_pub_after=$(ls "$OUT/img"/*.jpg 2>/dev/null | wc -l)
say "公网压缩图：$_pub_after 张（本轮新增 $((_pub_after - _pub_before))）"
# 源里是图片、压缩图却没增加，说明来源对不上（典型：文件名大小写变化被当成同一张，
# 或 pub_img.py 全部 skip）。
# 注意判据只数「图片」不数媒体：源里那 1 个 PNG 不进照片清单（只在视频/封面链里），
# 把视频算进来会让「578 vs 562」永远差一截，变成每次跑都刷一条假警告。
_img=$(ls -1 "$SRC" 2>/dev/null | grep -icE '\.(jpe?g|png|webp|bmp|tiff?|heic)$')
if [ "$_img" -gt "$_pub_after" ]; then
  say "⚠ 源目录 $_img 张图片，压缩图只有 $_pub_after 张 —— 有新增没进发布目录，查上面 pub_img.py 输出"
fi

# ── 4. 视频：新片入队 + 备份原片 + 统一小写 + 转码 + 抽首帧封面 ────────────
say "=== 4/8 处理视频 ==="
ORIG=$P/orig_video
mkdir -p "$ORIG" "$OUT/video/poster"

# 4a. /srv/pub/video 里可能残留旧流程丢下的**原片**，需要挪进备份目录。
#
#     判据必须同时满足两条，缺一不可：
#       ① 同名文件不在 orig_video（没备份）
#       ② 同名**封面**也不在 poster（没有封面 = 不是转码成品）
#
#     为什么不能用体积判：转码成品 9.9M / 原片 26.5M，体积差确实明显，
#     但只要 video/ 空着，4c 就会重转，转出来的成品体积又和上次一样 —— 于是
#     「迁走→重转→再迁走→再重转」可以无限循环。实测连跑两遍都白转 16 个视频。
#     封面是转码成功的副产物，永远和成品同时出现，用它当「这是成品」的凭证最稳。
#     体积只作为第二道保险：有备份、有封面、还比备份大 → 那才是真原片。
for f in "$OUT"/video/*.mp4 "$OUT"/video/*.MP4 "$OUT"/video/*.mov "$OUT"/video/*.MOV; do
  [ -f "$f" ] || continue
  n=$(basename "$f")
  low=$(printf '%s' "$n" | tr 'A-Z' 'a-z')
  low=$(printf '%s' "$low" | sed 's/\.mov$/.mp4/')
  key=${low%.mp4}
  if [ -f "$OUT/video/poster/$key.jpg" ]; then
    continue                          # 有封面 → 成品，原样保留
  fi
  if [ ! -f "$ORIG/$low" ]; then
    mv "$f" "$ORIG/$low" && say "  迁移 $n -> $low"
  elif [ "$(stat -c %s "$f")" -gt "$(stat -c %s "$ORIG/$low")" ]; then
    mv -f "$f" "$ORIG/$low" && say "  替换备份 $n（比现有备份大，认作原片）"
  else
    say "  跳过 $n（无封面但已有更大备份，留着不动）"
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
