#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_content.py —— 把「应用版 db.json」的元数据与「NAS index.json」的媒体地址合并，
产出 NAS 路线的 data/content.json（静态站点可直接 fetch 的唯一内容源）。

合并规则（按文件名归一后匹配，不依赖顺序、不依赖 id）：
  NAS index.json  →  src(直链) / w,h(尺寸) / d(拍摄日期) / k(photo|video)
  应用 db.json    →  title / desc / place / tags / hidden / featured / eventId / sort等元数据

原则：NAS 有图但 DB 没有元数据的（如 img_6531），也照样输出（元数据留空）；
      DB 有记录但 NAS 已无文件的，丢弃并在报告里列出（避免出现死链）。

用法：python3 build_content.py [--db <db.json>] [--nas <index.json>] [--out <content.json>]
"""
import json
import re
import sys
import argparse
import urllib.request
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                       # love-album/
DEFAULT_DB = ROOT.parent / "love-album-app" / "data" / "db.json"
DEFAULT_OUT = ROOT / "data" / "content.json"

# 旧库（应用版 db.json）里没有、只在 NAS 路线里才有的配置项。
# 重跑本脚本时要从现有 content.json 里原样带过来，否则后台改过的首页配置会被抹掉。
CARRY_KEYS = ("home",)


def carry_over_meta():
    """读现有 content.json 的 meta，取出需要保留的配置字段。"""
    if not DEFAULT_OUT.exists():
        return {}
    try:
        old = json.loads(DEFAULT_OUT.read_text(encoding="utf-8"))
    except Exception:
        return {}
    m = (old.get("meta") or {})
    return {k: m[k] for k in CARRY_KEYS if k in m and m[k]}



def norm(name: str) -> str:
    """文件名归一：去目录、转小写、去掉 (20260613-162348) 这类后缀、去扩展名。"""
    n = str(name or "").split("/")[-1].lower()
    n = re.sub(r"\(.*?\)", "", n)
    return re.sub(r"\.[a-z0-9]+$", "", n)


def as_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def ar_of(w, h, fallback=0.75):
    """宽高比；NAS 没给尺寸时用 3:4 兜底。"""
    w, h = as_int(w), as_int(h)
    if w > 0 and h > 0:
        return round(w / h, 4)
    return fallback


def load_nas(src):
    """src 可以是本地文件路径，也可以是 http(s) 地址。"""
    if str(src).startswith("http"):
        with urllib.request.urlopen(src, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    return json.loads(Path(src).read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB), help="应用版 db.json")
    ap.add_argument("--nas", default=str(ROOT / "base.json"), help="NAS index.json 地址或本地路径")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--base", default="", help="强制指定素材根地址；不填则读 base.json 的 base")
    args = ap.parse_args()

    db = json.loads(Path(args.db).read_text(encoding="utf-8"))

    base = args.base
    if not base:
        bj = json.loads((ROOT / "base.json").read_text(encoding="utf-8"))
        base = str(bj.get("base", "")).rstrip("/")
    nas_src = args.nas
    if str(nas_src).endswith("base.json"):
        nas_src = base + "/index.json"
    nas = load_nas(nas_src)
    items = [x for x in (nas.get("items") or []) if x and x.get("f")]

    # DB 侧按归一文件名建索引
    meta_by_name = {}
    for p in db.get("photos", []):
        meta_by_name.setdefault(norm(p.get("file")), p)

    photos, videos, unmatched_meta = [], [], []
    used = set()

    for x in items:
        key = norm(x["f"])
        m = meta_by_name.get(key)
        is_video = x.get("k") == "video"
        if m:
            used.add(key)

        if is_video:
            videos.append({
                "file": x["f"],
                "src": x["f"],          # 相对路径；运行时由 site.js 拼上 base.json 的地址
                "title": (m.get("title") if m else "") or Path(x["f"]).stem,
                "note": (m.get("desc") if m else "") or "",
                # NAS 清单目前没给视频宽高/日期（都是 0 / 空串），
                # 前端据此判断竖拍还是横拍、并决定标题位置
                "w": as_int(x.get("w")),
                "h": as_int(x.get("h")),
                "date": str(x.get("d") or ""),
                "size": as_int(x.get("s")),
            })
            continue

        pl = (m or {}).get("place") or {}
        photos.append({
            "file": x["f"],
            "src": x["f"],          # 相对路径；运行时由 site.js 拼上 base.json 的地址
            "title": (m or {}).get("title") or "",
            "desc": (m or {}).get("desc") or "",
            "date": x.get("d") or (m or {}).get("date") or "",
            "ar": ar_of(x.get("w"), x.get("h")),
            "w": as_int(x.get("w")),
            "h": as_int(x.get("h")),
            "lat": (m or {}).get("lat"),
            "lon": (m or {}).get("lon"),
            "place": {k: pl.get(k, "") for k in ("country", "province", "city", "district", "spot")},
            "tags": (m or {}).get("tags") or [],
            "eventId": (m or {}).get("eventId"),
            "hidden": bool((m or {}).get("hidden")),
            "featured": bool((m or {}).get("featured")),
            "sort": (m or {}).get("sort") or 0,
            "hasMeta": bool(m),
        })

    # DB 里有、NAS 上没有的照片：记下来，不输出（避免死链）
    for k, p in meta_by_name.items():
        if k not in used:
            unmatched_meta.append(p.get("file"))

    # 照片按日期倒序（同日按文件名），与旧站「新的在前」保持一致
    photos.sort(key=lambda p: (p["date"] or "", p["file"]), reverse=True)

    meta = db.get("meta", {})
    # 首页配置：旧库里没有就用现有 content.json 的（后台里改的值不能因为重跑脚本丢掉）
    home = dict(carry_over_meta().get("home") or {})
    home.update(meta.get("home") or {})
    out = {
        "version": 1,
        "builtAt": date.today().isoformat(),
        "base": "",           # 不再写死；页面运行时读 base.json
        "meta": {
            "anniversary": meta.get("anniversary", ""),
            "couple": meta.get("couple", {}),
            "hero": meta.get("hero", ""),
            "texts": meta.get("texts", {}),
            "home": home,
        },
        "events": db.get("events", []),
        "timeline": db.get("timeline", []),
        "quotes": db.get("quotes", []),
        "wishes": db.get("wishes", []),
        "photos": photos,
        "videos": videos,
    }

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    with_meta = sum(1 for p in photos if p["hasMeta"])
    print(f"base        : {base}")
    print(f"输出        : {args.out}")
    print(f"照片        : {len(photos)} 张（其中 {with_meta} 张带旧库元数据，{len(photos)-with_meta} 张仅 NAS 有）")
    print(f"视频        : {len(videos)} 个")
    print(f"时间轴/随手记/心愿/事件: {len(out['timeline'])} / {len(out['quotes'])} / {len(out['wishes'])} / {len(out['events'])}")
    if unmatched_meta:
        print(f"⚠ DB 有记录但 NAS 无文件 {len(unmatched_meta)} 张（已跳过）: {unmatched_meta[:8]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
