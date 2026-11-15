#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mkthumb.py —— 为已发布的照片生成网格用缩略图

为什么需要：
  pub_img.py 输出的原图长边 2048、单张 200 KB ~ 1.2 MB。隧道实测 90~450 KB/s，
  一张 1 MB 的图要两三秒。首页四列网格里每张只占 300 px 宽，没必要下原图。

做什么：
  /srv/pub/img/*.jpg  →  /srv/pub/img/t/*.jpg
  长边 720（四列布局在 2 倍屏下约需 600 px），JPEG q78 + progressive。
  体积通常降到原图的 5%~12%。

设计要点：
  1. 幂等 + 增量：输出比源新就跳过，重复跑只处理新增/改过的照片。
  2. 不阻断：单张失败只记日志，不影响其余照片，也不影响 index.json 生成。
  3. 不碰原图：只读 img/，只写 img/t/，删缩略图随时可以重来。
  4. 原子写：先写 .tmp 再 rename，避免 Caddy 读到半截文件。

用法：
  python3 mkthumb.py [/srv/pub] [--edge 720] [--quality 78] [--force]
  python3 mkthumb.py /srv/pub --clean     # 清空 img/t/ 后重建

Alpine 上装依赖：
  apk add --no-cache python3 py3-pillow
"""
import argparse
import os
import sys
import time

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("缺少 Pillow。Alpine: apk add --no-cache python3 py3-pillow")

EXTS = {".jpg", ".jpeg"}


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024.0


def build(src, dst, edge, quality):
    """生成一张缩略图。返回 (输出字节数, 宽, 高)。"""
    tmp = dst + ".tmp"
    with Image.open(src) as raw:
        # 原图已经是 exif_transpose 过的（pub_img.py 烘焙了方向），
        # 这里再调一次是幂等的：没有 Orientation 标记时它直接返回原图。
        im = ImageOps.exif_transpose(raw)
        if im.mode != "RGB":
            im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, float(edge) / max(w, h))
        if scale < 1.0:
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        im.save(tmp, "JPEG", quality=quality, optimize=True, progressive=True)
        size = os.path.getsize(tmp)
        ow, oh = im.size
    os.replace(tmp, dst)          # 原子替换，Caddy 不会读到半截
    return size, ow, oh


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default="/srv/pub")
    ap.add_argument("--edge", type=int, default=720, help="长边像素，默认 720")
    ap.add_argument("--quality", type=int, default=78, help="JPEG 质量，默认 78")
    ap.add_argument("--force", action="store_true", help="忽略时间戳，全部重建")
    ap.add_argument("--clean", action="store_true", help="先清空 img/t/ 再重建")
    a = ap.parse_args()

    imgdir = os.path.join(a.root, "img")
    thdir = os.path.join(imgdir, "t")
    if not os.path.isdir(imgdir):
        sys.exit(f"找不到照片目录：{imgdir}")
    os.makedirs(thdir, exist_ok=True)

    if a.clean:
        for n in os.listdir(thdir):
            if n.endswith((".jpg", ".tmp")):
                os.remove(os.path.join(thdir, n))
        print("已清空 img/t/")

    names = sorted(
        n for n in os.listdir(imgdir)
        if os.path.isfile(os.path.join(imgdir, n)) and os.path.splitext(n)[1].lower() in EXTS
    )
    if not names:
        sys.exit(f"{imgdir} 里没有 jpg")

    t0 = time.time()
    ok = skip = fail = 0
    src_bytes = out_bytes = 0
    for i, name in enumerate(names, 1):
        src = os.path.join(imgdir, name)
        dst = os.path.join(thdir, name)
        try:
            st = os.stat(src)
            if not a.force and os.path.exists(dst) and os.path.getmtime(dst) >= st.st_mtime:
                skip += 1
                src_bytes += st.st_size
                out_bytes += os.path.getsize(dst)
                continue
            size, w, h = build(src, dst, a.edge, a.quality)
            ok += 1
            src_bytes += st.st_size
            out_bytes += size
        except Exception as e:
            fail += 1
            print(f"ERR {name}: {e}", file=sys.stderr)
        if i % 100 == 0 or i == len(names):
            print(f"  {i}/{len(names)}  new={ok} skip={skip} fail={fail}", file=sys.stderr)

    # 清掉源头已消失的孤儿缩略图
    keep = set(names)
    orphans = [n for n in os.listdir(thdir) if n.lower().endswith(".jpg") and n not in keep]
    for n in orphans:
        os.remove(os.path.join(thdir, n))

    print(f"缩略图: {len(names)} 张  新建 {ok} / 跳过 {skip} / 失败 {fail} / 清理孤儿 {len(orphans)}")
    print(f"体积: {human(src_bytes)} → {human(out_bytes)}"
          f"（{(out_bytes / src_bytes * 100 if src_bytes else 0):.0f}%），耗时 {time.time() - t0:.1f}s")
    print(f"输出目录: {thdir}")


if __name__ == "__main__":
    main()
