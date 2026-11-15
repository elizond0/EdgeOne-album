#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pub_img.py —— 相册公网发布版图片生成器（规则固化版）

固化的规则（顺序不可调换，调换会出错）：
  1. 先读 EXIF 拍摄时间（后面会被丢弃，必须提前取）
  2. 再 exif_transpose() 把 Orientation 烘焙进像素
     —— iPhone 竖拍像素是横的，靠 EXIF 标记旋转；先删 EXIF 再去方向 = 全躺下
  3. 统一转 RGB（PNG 透明底填白，避免黑底）
  4. 长边限制 2048，LANCZOS 重采样
  5. 输出 JPEG q85 + progressive + optimize，且**不传** exif/icc_profile
  6. 输出文件名统一小写 .jpg（避免大小写造成 404）

用法：python3 pub_img.py <源目录> <输出目录>
产出：<输出>/img/*.jpg 与 <输出>/img_index.json
"""
import json
import os
import sys

from PIL import Image, ImageOps

DATE_ORIGINAL = 36867   # DateTimeOriginal
DATE_DIGITIZED = 36868
DATE_IFD = 306          # DateTime
LONG_EDGE = 2048
QUALITY = 85
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def pick_date(im, path):
    """优先 EXIF，回退文件 mtime。返回 YYYY-MM-DD。"""
    try:
        ex = im.getexif()
        for tag in (DATE_ORIGINAL, DATE_DIGITIZED, DATE_IFD):
            v = ex.get(tag)
            if v:
                s = str(v).strip()
                if len(s) >= 10:
                    return s[:10].replace(":", "-")
    except Exception:
        pass
    try:
        import datetime
        return datetime.datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d")
    except Exception:
        return ""


def to_rgb(im):
    if im.mode == "RGB":
        return im
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def main():
    if len(sys.argv) < 3:
        sys.exit("用法: pub_img.py <源目录> <输出目录>")
    src, out = sys.argv[1], sys.argv[2]
    imgdir = os.path.join(out, "img")
    os.makedirs(imgdir, exist_ok=True)

    names = sorted(n for n in os.listdir(src)
                   if os.path.isfile(os.path.join(src, n))
                   and os.path.splitext(n)[1].lower() in EXTS)

    items, ok, fail, saved_in, saved_out = [], 0, 0, 0, 0
    for i, name in enumerate(names, 1):
        p = os.path.join(src, name)
        stem = os.path.splitext(name)[0]
        dst = os.path.join(imgdir, stem.lower() + ".jpg")
        try:
            with Image.open(p) as raw:
                date = pick_date(raw, p)
                im = ImageOps.exif_transpose(raw)      # 关键：方向烘焙
                im = to_rgb(im)
                w0, h0 = im.size
                scale = min(1.0, LONG_EDGE / float(max(w0, h0)))
                if scale < 1.0:
                    im = im.resize((max(1, round(w0 * scale)), max(1, round(h0 * scale))),
                                   Image.LANCZOS)
                # 不传 exif / icc_profile —— PIL 因此不会写入任何元信息
                im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True)
                w, h = im.size
            items.append({"f": os.path.basename(dst), "d": date, "w": w, "h": h, "k": "photo"})
            saved_in += os.path.getsize(p)
            saved_out += os.path.getsize(dst)
            ok += 1
        except Exception as e:
            fail += 1
            print(f"ERR {name}: {e}", file=sys.stderr)
        if i % 50 == 0 or i == len(names):
            print(f"  {i}/{len(names)}", file=sys.stderr)

    items.sort(key=lambda x: (x["d"], x["f"]), reverse=True)
    idx = os.path.join(out, "img_index.json")
    with open(idx, "w", encoding="utf-8") as f:
        json.dump({"count": len(items), "items": items}, f, ensure_ascii=False, indent=1)

    print(json.dumps({
        "ok": ok, "fail": fail,
        "src_MB": round(saved_in / 1048576, 1),
        "out_MB": round(saved_out / 1048576, 1),
        "ratio": round(saved_out / saved_in, 3) if saved_in else 0,
        "index": idx,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
