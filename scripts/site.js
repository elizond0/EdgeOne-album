/* ============================================
   site.js —— NAS 路线的内容层与交互层
   数据源：data/content.json（由 scripts/build_content.py 生成）
           其中每个媒体项都带 NAS 直链 src，页面只做渲染。
   对外：window.Site
   ============================================ */
(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const Site = { esc, db: null, ready: false, error: "", base: "", mediaError: "" };
  window.Site = Site;

  /* ---------- 内容加载 ---------- */
  // content.json 里存的是相对路径（img/xxx.jpg）。真实的 NAS 地址在 base.json，
  // 由 NAS 开机时自动改写。这样隧道地址一换，只改 base.json 就行，
  // 不用重新构建、不用重新推 Git。
  Site.load = async function () {
    try {
      const r = await fetch("data/content.json?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("content.json HTTP " + r.status);
      Site.db = await r.json();
      Site.ready = true;
    } catch (e) {
      Site.error = String((e && e.message) || e);
      console.warn("[Site] 内容加载失败：", Site.error);
      return Site;
    }
    // 取 NAS 地址（失败不阻塞文字内容，只是图片出不来）
    try {
      const br = await fetch("base.json?_=" + Date.now(), { cache: "no-store" });
      if (!br.ok) throw new Error("base.json HTTP " + br.status);
      Site.base = String((await br.json()).base || "").replace(/\/+$/, "");
      if (!Site.base) throw new Error("base.json 里没有 base 字段");
    } catch (e) {
      Site.mediaError = String((e && e.message) || e);
      console.warn("[Site] NAS 地址读取失败：", Site.mediaError);
      Site.base = "";
    }
    Site.attachBase();
    return Site;
  };

  // 把相对路径拼成可用的完整地址；base 缺失时留空，让上层决定怎么提示
  Site.media = function (rel) {
    const f = String(rel || "");
    if (!f) return "";
    if (/^https?:\/\//i.test(f)) return f;
    return Site.base ? Site.base + "/" + f.replace(/^\/+/, "") : "";
  };

  Site.attachBase = function () {
    const db = Site.db;
    if (!db) return;
    (db.photos || []).forEach((p) => (p.src = Site.media(p.file || p.src)));
    (db.videos || []).forEach((v) => (v.src = Site.media(v.file || v.src)));
    db.base = Site.base;
  };

  /* ---------- 文案：meta.texts 优先 ---------- */
  Site.text = (key, fb) => {
    const t = Site.db && Site.db.meta && Site.db.meta.texts;
    const v = t && t[key];
    return v == null || v === "" ? (fb || "") : v;
  };
  Site.applyTexts = function (scope) {
    (scope || document).querySelectorAll("[data-text]").forEach((n) => {
      const v = Site.text(n.dataset.text, n.textContent);
      if (v) n.textContent = v;
    });
    // 标题：首页用站点全名，子页保留自己的「页名 · 站名」，别被统统改成一个名字
    const t = Site.db && Site.db.meta && Site.db.meta.texts;
    const full = (t && t.siteTitle) || "";
    const h1 = document.querySelector("main h1");
    const isHome = !document.querySelector(".subpage");
    if (full && isHome) document.title = full;
    else if (full) {
      const pageName = (h1 && h1.textContent.trim()) || document.title.split(" · ")[0];
      const short = (t && t.siteShort) || full.split(" · ")[0] || full;
      // 页名已经在标题里就别拼第二遍
      document.title = pageName.indexOf(short) === 0 ? pageName : pageName + " · " + short;
    }
  };

  /* ---------- 照片 ---------- */
  Site.visiblePhotos = function () {
    const list = (Site.db && Site.db.photos) || [];
    return list
      .filter((p) => !p.hidden)
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  };

  Site.placeLabel = function (p) {
    const pl = (p && p.place) || {};
    const parts = [pl.province, pl.city === pl.province ? "" : pl.city, pl.district, pl.spot];
    return parts.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("·") || p.title || "我们的日常";
  };

  /* ---------- 拍立得卡片（懒加载 + 入场） ---------- */
  let wallIO = null;
  Site.photoCard = function (p, i, all) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "wall__item reveal";
    node.setAttribute("aria-label", "查看照片：" + (p.title || p.file));
    const ar = p.ar || 0.75;
    node.innerHTML =
      '<div class="polaroid">' +
      '<span class="tape" aria-hidden="true"></span>' +
      `<img class="polaroid__img" alt="${esc(p.title)}" data-src="${esc(p.src)}" style="aspect-ratio:${ar}" />` +
      '<p class="polaroid__caption">' + esc(p.desc || p.title || "我们的日常") +
      (p.date
        ? '<span class="polaroid__date">' + esc(String(p.date).replace(/-/g, ".")) + " · " + esc(Site.placeLabel(p)) + "</span>"
        : "") +
      "</p></div>";
    node.addEventListener("click", () => Site.lightbox(all || Site.visiblePhotos(), i));

    const img = node.querySelector("img");
    if (!wallIO) {
      wallIO = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            const im = en.target.querySelector("img[data-src]");
            if (im) { im.src = im.dataset.src; im.removeAttribute("data-src"); }
            wallIO.unobserve(en.target);
          }),
        { rootMargin: "600px 0px" }
      );
    }
    wallIO.observe(node);
    Site.reveal(node, (i % 8) * 45);
    return node;
  };

  /* ---------- 入场动画（单向，不来回触发） ---------- */
  let revealIO = null;
  Site.reveal = function (node, delay) {
    node.classList.add("reveal");
    if (delay) node.style.setProperty("--reveal-delay", delay + "ms");
    if (!revealIO) {
      revealIO = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add("in"); revealIO.unobserve(en.target); }
          }),
        { threshold: 0.1 }
      );
    }
    revealIO.observe(node);
  };
  /* 接管 HTML 里静态写死的 .reveal，否则它们永远停在 opacity:0 */
  Site.revealAll = function () {
    document.querySelectorAll(".reveal:not(.in)").forEach((n) => {
      if (!revealIO) {
        revealIO = new IntersectionObserver(
          (entries) =>
            entries.forEach((en) => {
              if (en.isIntersecting) { en.target.classList.add("in"); revealIO.unobserve(en.target); }
            }),
          { threshold: 0.1 }
        );
      }
      revealIO.observe(n);
    });
  };

  /* ---------- 灯箱 ---------- */
  const SVG = {
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  };

  Site.lightbox = function (items, index) {
    let lb = $("#lightbox");
    if (!lb) {
      lb = document.createElement("div");
      lb.id = "lightbox";
      lb.className = "lightbox";
      lb.hidden = true;
      lb.setAttribute("role", "dialog");
      lb.setAttribute("aria-modal", "true");
      lb.innerHTML =
        '<button class="lightbox__btn lightbox__close" data-a="close" aria-label="关闭">' + SVG.close + "</button>" +
        '<button class="lightbox__btn lightbox__prev" data-a="prev" aria-label="上一张">' + SVG.prev + "</button>" +
        '<img class="lightbox__img" alt="" />' +
        '<button class="lightbox__btn lightbox__next" data-a="next" aria-label="下一张">' + SVG.next + "</button>" +
        '<p class="lightbox__caption"></p>';
      document.body.appendChild(lb);
      // SVG 会成为 e.target，必须用 closest 取按钮，否则 dataset 读空、按钮全失效
      lb.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-a]");
        const a = btn && btn.dataset.a;
        if (a === "close") Site.lightbox.close();
        else if (a === "prev") Site.lightbox.step(-1);
        else if (a === "next") Site.lightbox.step(1);
        else if (e.target === lb) Site.lightbox.close();
      });
      document.addEventListener("keydown", (e) => {
        if (lb.hidden) return;
        if (e.key === "Escape") Site.lightbox.close();
        if (e.key === "ArrowLeft") Site.lightbox.step(-1);
        if (e.key === "ArrowRight") Site.lightbox.step(1);
      });
      // 触屏左右滑
      let tx = 0, ty = 0, on = false;
      lb.addEventListener("touchstart", (e) => { on = true; tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
      lb.addEventListener("touchend", (e) => {
        if (!on) return;
        on = false;
        const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) Site.lightbox.step(dx < 0 ? 1 : -1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.6) Site.lightbox.close();
      }, { passive: true });
    }
    Site.lightbox.items = items || [];
    Site.lightbox.idx = index || 0;
    Site.lightbox.fill();
    lb.hidden = false;
    requestAnimationFrame(() => lb.classList.add("open"));
    document.body.style.overflow = "hidden";
  };

  Site.lightbox.fill = function () {
    const lb = $("#lightbox");
    const p = Site.lightbox.items[Site.lightbox.idx];
    if (!lb || !p) return;
    lb.querySelector(".lightbox__img").src = p.src;
    lb.querySelector(".lightbox__img").alt = p.title || "";
    const place = Site.placeLabel(p);
    lb.querySelector(".lightbox__caption").textContent =
      (p.title && p.title !== place ? p.title + " · " : "") + place +
      (p.date ? " · " + String(p.date).replace(/-/g, ".") : "");
  };

  Site.lightbox.close = function () {
    const lb = $("#lightbox");
    if (!lb) return;
    lb.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => { lb.hidden = true; }, 280);
  };

  /* 左右滑动：先退场再换图再进场；_busy 防连点错乱 */
  Site.lightbox.step = function (d) {
    const lb = $("#lightbox");
    const items = Site.lightbox.items || [];
    const n = items.length;
    if (!n || !lb || Site.lightbox._busy) return;
    const dir = d > 0 ? 1 : -1;
    Site.lightbox.idx = (Site.lightbox.idx + d + n) % n;
    const img = lb.querySelector(".lightbox__img");
    const cap = lb.querySelector(".lightbox__caption");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { Site.lightbox.fill(); return; }
    Site.lightbox._busy = true;
    img.style.setProperty("--slide-dir", dir);
    img.classList.add("is-out");
    cap.classList.add("is-out");
    setTimeout(() => {
      Site.lightbox.fill();
      img.classList.remove("is-out");
      img.classList.add("is-in");
      cap.classList.remove("is-out");
      cap.classList.add("is-in");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          img.classList.remove("is-in");
          cap.classList.remove("is-in");
          Site.lightbox._busy = false;
        })
      );
    }, 170);
  };

  /* ---------- 时间轴 ---------- */
  Site.renderTimeline = function (container, items) {
    if (!container) return;
    container.innerHTML = "";
    (items || []).forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "timeline__item";
      li.innerHTML =
        '<span class="timeline__dot" aria-hidden="true"></span>' +
        '<p class="timeline__date">' + esc(t.date) + "</p>" +
        '<h3 class="timeline__title">' + esc(t.title) + "</h3>" +
        '<p class="timeline__text">' + esc(t.text) + "</p>";
      container.appendChild(li);
      Site.reveal(li, (i % 4) * 70);
    });
  };

  /* ---------- 随手记 ---------- */
  Site.renderQuotes = function (container, items) {
    if (!container) return;
    container.innerHTML = "";
    (items || []).forEach((q, i) => {
      const card = document.createElement("blockquote");
      card.className = "quote";
      card.style.setProperty("--tilt", ((i * 47) % 7) - 3 + "deg");
      card.innerHTML =
        '<p class="quote__text">「' + esc(q.text) + "」</p>" +
        (q.tag ? '<cite class="quote__tag">—— ' + esc(q.tag) + "</cite>" : "");
      container.appendChild(card);
      Site.reveal(card, (i % 3) * 90);
    });
  };

  /* ---------- 心愿单（TodoList 风格，待解锁 / 已解锁两块） ---------- */
  Site.renderWishes = function (container, items) {
    if (!container) return;
    container.innerHTML = "";
    const all = items || [];
    const mkGroup = (title, arr, cls) => {
      if (!arr.length) return null;
      const box = document.createElement("div");
      box.className = "wishbox " + cls;
      const h = document.createElement("h3");
      h.className = "wishbox__head";
      h.innerHTML = esc(title) + "<small>" + arr.length + "</small>";
      box.appendChild(h);
      arr.forEach((w, i) => {
        const card = document.createElement("div");
        card.className = "wish reveal" + (w.done ? " wish--done" : "");
        card.innerHTML =
          '<span class="wish__check" aria-hidden="true">' + (w.done ? "✓" : "") + "</span>" +
          '<span class="wish__emoji" aria-hidden="true">' + esc(w.emoji || "✨") + "</span>" +
          '<span class="wish__text' + (w.done ? " is-done" : "") + '">' + esc(w.text) + "</span>" +
          '<span class="wish__mark">' + (w.done ? "已解锁" : "待解锁") + "</span>";
        box.appendChild(card);
        Site.reveal(card, (i % 4) * 60);
      });
      return box;
    };
    const b1 = mkGroup("待解锁", all.filter((w) => !w.done), "wishbox--todo");
    const b2 = mkGroup("已解锁", all.filter((w) => w.done), "wishbox--done");
    if (b1) container.appendChild(b1);
    if (b2) container.appendChild(b2);
  };

  /* ---------- 影像 ---------- */
  /* ---------- 影像 ---------- */
  // 手机竖拍视频占大多数（1080×1920），横盒子 + object-fit:cover 会把画面裁掉大半，
  // 因此按真实比例决定卡片是竖版还是横版。NAS 清单没给尺寸时用元数据兜底。
  Site.renderVideos = function (container, items) {
    if (!container) return;
    container.innerHTML = "";
    const fmt = (s) => {
      s = Math.round(+s || 0);
      return s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : s + "s";
    };
    (items || []).forEach((v, i) => {
      const portrait = +(v.h || 0) > +(v.w || 0);
      const card = document.createElement("article");
      card.className = "video-card" + (portrait ? " video-card--portrait" : "");
      card.style.setProperty("--reveal-delay", (i % 3) * 100 + "ms");
      const vid = document.createElement("video");
      vid.controls = true;
      vid.preload = "metadata";
      vid.setAttribute("playsinline", "");
      vid.src = v.src;
      // 拿到时长后补一行小字，没有标题时它就是唯一的说明
      vid.addEventListener(
        "loadedmetadata",
        () => {
          if (vid.duration && isFinite(vid.duration)) meta.textContent = fmt(vid.duration);
        },
        { once: true }
      );
      const frame = document.createElement("div");
      frame.className = "video-card__frame";
      frame.appendChild(vid);
      const body = document.createElement("div");
      body.className = "video-card__body";
      const h3 = document.createElement("h3");
      h3.className = "video-card__title";
      const d = String(v.date || "");
      h3.textContent = d ? d.replace(/-/g, ".") : "片段";
      const meta = document.createElement("span");
      meta.className = "video-card__meta";
      body.appendChild(h3);
      body.appendChild(meta);
      card.appendChild(frame);
      card.appendChild(body);
      container.appendChild(card);
      // NAS 清单没给宽高 → 等元数据到了再定卡片是竖版还是横版
      if (!portrait) {
        vid.addEventListener(
          "loadedmetadata",
          () => {
            if (vid.videoHeight > vid.videoWidth) {
              card.classList.add("video-card--portrait");
              vid.style.objectFit = "contain";
            }
          },
          { once: true }
        );
      }
      Site.reveal(card, (i % 3) * 100);
    });
  };

  /* ---------- 首页配置（后台可调，缺省有默认值） ---------- */
  Site.homeCfg = function () {
    const h = (Site.db && Site.db.meta && Site.db.meta.home) || {};
    const ALL = ["timeline", "photos", "quotes", "wishes", "videos"];
    return {
      timelineCount: Math.max(1, +h.timelineCount || 5),
      photoRows: Math.max(1, +h.photoRows || 2),
      quoteRows: Math.max(1, +h.quoteRows || 1),
      wishCount: Math.max(2, +h.wishCount || 8),
      showVideos: h.showVideos || "auto", // auto | show | hide
      order: (Array.isArray(h.order) && h.order.length ? h.order : ALL).filter((k) => ALL.includes(k)),
    };
  };

  /* ---------- 板块「幻灯片式」渐入（单向触发，不闪烁） ---------- */
  Site.initSlides = function (scope) {
    const root = scope || document;
    const secs = root.querySelectorAll("main > [data-sec], .home-slide");
    if (!secs.length) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (en.isIntersecting && en.intersectionRatio > 0.12) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        }),
      { threshold: [0.12], rootMargin: "0px 0px -6% 0px" }
    );
    secs.forEach((s) => {
      s.classList.add("home-slide");
      if (s.getBoundingClientRect().top < window.innerHeight * 0.6) s.classList.add("in");
      else io.observe(s);
    });
    // 兜底：观察器不回调的环境里，6 秒后强制显示
    setTimeout(() => secs.forEach((s) => s.classList.add("in")), 6000);
  };

  /* ---------- 相恋天数 ---------- */
  Site.renderDays = function () {
    const ann = (Site.db && Site.db.meta && Site.db.meta.anniversary) || "";
    const start = ann ? new Date(ann + "T00:00:00") : null;
    const days = start && !isNaN(start) ? Math.max(0, Math.floor((Date.now() - start) / 86400000)) : 0;
    const set = (id, v) => { const n = $("#" + id); if (n) n.textContent = v; };
    set("days-count", days.toLocaleString("zh-CN"));
    set("since-date", ann.replace(/-/g, "."));
    set("since-year", ann.slice(0, 4));
  };

  /* ---------- 结语：内容就绪事件 ---------- */
  Site.boot = async function () {
    await Site.load();
    Site.applyTexts();
    Site.renderDays();
    Site.revealAll();
    document.dispatchEvent(new CustomEvent("site:ready", { detail: Site.db }));
  };
})();
