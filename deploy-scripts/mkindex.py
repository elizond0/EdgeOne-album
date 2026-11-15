#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mkindex.py —— 合并图片索引与视频文件，生成站点读取的 index.json
路径一律相对（img/xxx.jpg、video/xxx.mp4），域名由 base.json 提供。
"""
import json
import os
import subprocess
from datetime import datetime

OUT = "/srv/pub"
items = []

# 图片：复用 pub_img.py 的产出
ip = os.path.join(OUT, "img_index.json")
if os.path.exists(ip):
    with open(ip, encoding="utf-8") as f:
        for i in json.load(f)["items"]:
            items.append({"f": "img/" + i["f"], "d": i.get("d", ""),
                          "w": i.get("w", 0), "h": i.get("h", 0), "k": "photo"})


def probe_video(path):
    """用 ffprobe 读视频的拍摄日期与宽高，读不到就回空值（不阻断生成）。

    手机竖拍常见「宽高 + rotation 标记」，直接拿 width/height 会得到反的横竖，
    所以按 side_data 里的 rotation 交换一次。日期优先 creation_time，
    没有就退回文件修改时间。ffprobe 未安装时整段降级，行为和以前一致。
    """
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=20,
        ).stdout
        j = json.loads(out or "{}")
    except Exception:
        return "", 0, 0

    w = h = 0
    for st in j.get("streams", []):
        if st.get("codec_type") != "video":
            continue
        w = int(st.get("width") or 0)
        h = int(st.get("height") or 0)
        rot = 0
        for sd in (st.get("side_data_list") or []):
            if "rotation" in sd:
                try:
                    rot = int(float(sd["rotation"]))
                except (TypeError, ValueError):
                    rot = 0
        if rot % 180 != 0 and w and h:
            w, h = h, w
        break

    d = ""
    tags = (j.get("format") or {}).get("tags") or {}
    ct = tags.get("creation_time") or tags.get("Creation Time") or ""
    if ct:
        d = str(ct)[:10]
    if not d:
        try:
            d = datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d")
        except Exception:
            d = ""
    return d, w, h


# 视频：扫目录，逐个读元数据
vd = os.path.join(OUT, "video")
if os.path.isdir(vd):
    for n in sorted(os.listdir(vd)):
        if not n.lower().endswith(".mp4"):
            continue
        p = os.path.join(vd, n)
        d, w, h = probe_video(p)
        items.append({"f": "video/" + n, "d": d, "w": w, "h": h,
                      "k": "video", "s": os.path.getsize(p)})

items.sort(key=lambda x: (x["d"], x["f"]), reverse=True)
doc = {
    "version": 1,
    "count": len(items),
    "photos": sum(1 for x in items if x["k"] == "photo"),
    "videos": sum(1 for x in items if x["k"] == "video"),
    "items": items,
}
with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print(json.dumps({"count": doc["count"], "photos": doc["photos"],
                  "videos": doc["videos"]}, ensure_ascii=False))
