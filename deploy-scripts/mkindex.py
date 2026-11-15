#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mkindex.py —— 合并图片索引与视频文件，生成站点读取的 index.json
路径一律相对（img/xxx.jpg、video/xxx.mp4），域名由 base.json 提供。
"""
import json
import os

OUT = "/srv/pub"
items = []

# 图片：复用 pub_img.py 的产出
ip = os.path.join(OUT, "img_index.json")
if os.path.exists(ip):
    with open(ip, encoding="utf-8") as f:
        for i in json.load(f)["items"]:
            items.append({"f": "img/" + i["f"], "d": i.get("d", ""),
                          "w": i.get("w", 0), "h": i.get("h", 0), "k": "photo"})

# 视频：直接扫目录
vd = os.path.join(OUT, "video")
if os.path.isdir(vd):
    for n in sorted(os.listdir(vd)):
        if not n.lower().endswith(".mp4"):
            continue
        p = os.path.join(vd, n)
        items.append({"f": "video/" + n, "d": "", "w": 0, "h": 0,
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
