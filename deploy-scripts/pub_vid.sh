#!/bin/sh
# 批量转码：HLG HDR → H.264 SDR，保留 creation_time，跳过已存在
SRC=/srv/csy
OUT=/srv/pub/video
mkdir -p "$OUT"
VF="zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
for f in "$SRC"/*.MOV "$SRC"/*.mov; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  n=${b%.*}
  o="$OUT/$n.mp4"
  if [ -f "$o" ]; then
    echo "SKIP $n"
    continue
  fi
  echo "=== $(date +%H:%M:%S) START $n"
  ffmpeg -y -i "$f" -vf "$VF" -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 128k -movflags +faststart -map_metadata 0 -map_chapters 0 "$o" >/dev/null 2>&1
  echo "=== $(date +%H:%M:%S) DONE $n exit=$? size=$(stat -c%s "$o" 2>/dev/null)"
done
echo ALL_VID_DONE
