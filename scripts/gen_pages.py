#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_pages.py —— 由统一模板生成 NAS 路线的 5 个子页面。

为什么用脚本生成：导航/页脚/脚本引入顺序必须逐字一致，
手写 5 份迟早漂移（漏一个 data-text、少一个脚本），而这类错误不会报错、只会静默失效。

用法：python3 scripts/gen_pages.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

NAV = """  <header class="nav">
    <a class="nav__logo" href="/"><span class="heart" aria-hidden="true">♥</span><span data-text="siteShort">我们的故事</span></a>
    <nav aria-label="页面导航">
      <ul class="nav__links">
        <li><a href="/" data-text="navHome">首页</a></li>
        <li><a href="/timeline.html" data-text="navTimeline">时间轴</a></li>
        <li><a href="/photos.html" data-text="navPhotos">照片墙</a></li>
        <li><a href="/quotes.html" data-text="navQuotes">随手记</a></li>
        <li><a href="/wishes.html" data-text="navWishes">心愿单</a></li>
        <li><a href="/videos.html" data-text="navVideos">影像</a></li>
      </ul>
    </nav>
  </header>"""

FOOTER = """  <footer class="footer">
    <p><span data-text="footerNote">为了我们的纪念日，页面会一直更新下去</span> <span class="heart" aria-hidden="true">♥</span></p>
    <p class="form__hint"><span data-text="footerSub">私密分享页面</span> · <a href="/admin.html" style="color:inherit" data-text="navAdmin">后台</a></p>
  </footer>"""

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>{title} · 我们的故事</title>
  <link rel="stylesheet" href="assets/fonts/wenkai.css" media="print" onload="this.media='all'" />
  <noscript><link rel="stylesheet" href="assets/fonts/wenkai.css" /></noscript>
  <link rel="stylesheet" href="styles/tokens.css" />
  <link rel="stylesheet" href="styles/base.css" />
  <link rel="stylesheet" href="styles/components.css" />
</head>
<body>
  <div class="atmosphere" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>

{nav}

  <main class="subpage">
    <section class="section{sec_class}">
      <header class="section__head reveal">
        <p class="section__eyebrow">{eyebrow}</p>
        <h1 class="section__title" data-text="{text_key}">{title}</h1>
        <p class="section__desc" data-text="{text_key}Desc"></p>
{extra_head}      </header>
{body}
    </section>
  </main>

{footer}

  <script src="scripts/site.js"></script>
  <script src="scripts/page-{page}.js"></script>
  <script>Site.boot();</script>
</body>
</html>
"""

PAGES = [
    dict(
        page="timeline", file="timeline.html", title="时间轴", eyebrow="TIMELINE",
        text_key="secTimeline", sec_class="",
        extra_head="",
        body='      <ol class="timeline" id="page-timeline"></ol>',
    ),
    dict(
        page="photos", file="photos.html", title="照片墙", eyebrow="PHOTOS",
        text_key="secPhotos", sec_class="",
        # 上传入口已迁到后台，前台只留地点筛选
        extra_head="""        <div class="wall-toolbar">
          <select id="place-filter" aria-label="按地点筛选">
            <option value="">全部地点</option>
          </select>
        </div>
""",
        body='      <div class="wall" id="wall"></div>\n      <p class="form__hint" id="wall-count"></p>',
    ),
    dict(
        page="quotes", file="quotes.html", title="随手记", eyebrow="NOTES",
        text_key="secQuotes", sec_class="",
        extra_head="",
        body='      <div class="quotes" id="page-quotes"></div>',
    ),
    dict(
        page="wishes", file="wishes.html", title="心愿单", eyebrow="WISH LIST",
        text_key="secWishes", sec_class="",
        extra_head="",
        body='      <div class="wishes page-wishes-split" id="page-wishes"></div>',
    ),
    dict(
        page="videos", file="videos.html", title="影像", eyebrow="VIDEOS",
        text_key="secVideos", sec_class=" videos-band",
        extra_head="",
        body='      <div class="videos" id="page-videos"></div>',
    ),
]


def main():
    for p in PAGES:
        html = TEMPLATE.format(nav=NAV, footer=FOOTER, **p)
        (ROOT / p["file"]).write_text(html, encoding="utf-8")
        print(f"  生成 {p['file']:<16} {len(html.encode('utf-8')):>6} B")
    print(f"共 {len(PAGES)} 个页面")


if __name__ == "__main__":
    main()
