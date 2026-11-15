/* ============================================
   admin.js —— NAS 路线的管理后台（纯静态版）
   与线上应用版的关键区别：静态站没有可写的后端，
   因此「保存」= 生成一份 data/content.json 让你下载，
   再由你放到 NAS 的公开目录覆盖同名文件（或交给更新脚本）。
   好处：不引入任何服务器，站点永远是可静态托管的。
   ============================================ */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const localToday = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  let db = null;
  let dirty = false;

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.style.borderColor = bad ? "#a13a2e" : "";
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2800);
  }

  /* ---------- 登录（本地校验，不涉及服务器） ---------- */
  const KEY_STORE = "album-admin-key";
  function getKey() { return sessionStorage.getItem(KEY_STORE) || ""; }

  $("#key-ok").addEventListener("click", () => {
    const k = $("#key-input").value.trim();
    if (k.length < 6) { $("#key-error").hidden = false; return; }
    sessionStorage.setItem(KEY_STORE, k);
    enter();
  });
  $("#key-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#key-ok").click(); });
  $("#logout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    sessionStorage.removeItem(KEY_STORE);
    location.reload();
  });

  async function enter() {
    $("#login-view").hidden = true;
    $("#panel-view").hidden = false;
    $("#logout-btn").hidden = false;
    const ok = await Site.load();
    if (!ok.ready) { toast("内容加载失败：" + Site.error, true); return; }
    db = JSON.parse(JSON.stringify(Site.db));
    renderBasic(); renderTexts();
    ["timeline", "quotes", "wishes", "events"].forEach(renderList);
    renderPhotos();
  }

  /* ---------- 标签页 ---------- */
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === b));
    document.querySelectorAll(".panel").forEach((p) => {
      p.hidden = p.id !== "panel-" + b.dataset.tab;
    });
  });

  function markDirty() { dirty = true; $("#dirty-tip").hidden = false; }

  /* ---------- 基本信息 / 首页设置 ---------- */
  const SEC_NAMES = { timeline: "时间轴", photos: "照片墙", quotes: "随手记", wishes: "心愿单", videos: "影像" };

  function renderBasic() {
    const m = db.meta || {};
    $("#f-anniversary").value = m.anniversary || "";
    $("#f-couple-a").value = (m.couple && m.couple.a) || "";
    $("#f-couple-b").value = (m.couple && m.couple.b) || "";
    $("#f-hero").value = m.hero || "";
    renderHomeCfg();
  }

  function renderHomeCfg() {
    const h = (db.meta && db.meta.home) || {};
    $("#f-h-tl").value = h.timelineCount || 5;
    $("#f-h-pr").value = h.photoRows || 2;
    $("#f-h-qr").value = h.quoteRows || 1;
    $("#f-h-wc").value = h.wishCount || 8;
    $("#f-h-videos").value = h.showVideos || "auto";
    renderHomeOrder();
  }

  function renderHomeOrder() {
    const ALL = ["timeline", "photos", "quotes", "wishes", "videos"];
    const h = (db.meta && db.meta.home) || {};
    const order = (Array.isArray(h.order) && h.order.length ? h.order : ALL).filter((k) => ALL.includes(k));
    const box = $("#home-order");
    box.innerHTML = order
      .map(
        (k, i) => `
      <div class="home-order__row">
        <span class="home-order__name">${esc(SEC_NAMES[k] || k)}</span>
        <span class="home-order__acts">
          <button type="button" data-ho="up" data-k="${k}" ${i === 0 ? "disabled" : ""} title="上移">↑</button>
          <button type="button" data-ho="down" data-k="${k}" ${i === order.length - 1 ? "disabled" : ""} title="下移">↓</button>
        </span>
      </div>`
      )
      .join("");
    box.dataset.order = order.join(",");
    // 让显隐下拉也反映当前顺序
  }

  $("#home-order").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ho]");
    if (!b) return;
    const order = $("#home-order").dataset.order.split(",");
    const i = order.indexOf(b.dataset.k);
    const j = b.dataset.ho === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    $("#home-order").dataset.order = order.join(",");
    // 立即重绘顺序（不动数据，保存时再写）
    const labels = order.map((k) => SEC_NAMES[k] || k);
    renderHomeOrderFromOrder(order);
    void labels;
    markDirty();
  });

  function renderHomeOrderFromOrder(order) {
    const box = $("#home-order");
    box.innerHTML = order
      .map(
        (k, i) => `
      <div class="home-order__row">
        <span class="home-order__name">${esc(SEC_NAMES[k] || k)}</span>
        <span class="home-order__acts">
          <button type="button" data-ho="up" data-k="${k}" ${i === 0 ? "disabled" : ""} title="上移">↑</button>
          <button type="button" data-ho="down" data-k="${k}" ${i === order.length - 1 ? "disabled" : ""} title="下移">↓</button>
        </span>
      </div>`
      )
      .join("");
    box.dataset.order = order.join(",");
  }

  $("#save-basic").addEventListener("click", () => {
    db.meta = db.meta || {};
    db.meta.anniversary = $("#f-anniversary").value;
    db.meta.couple = { a: $("#f-couple-a").value.trim(), b: $("#f-couple-b").value.trim() };
    db.meta.hero = $("#f-hero").value.trim();
    db.meta.home = {
      timelineCount: Math.max(1, +$("#f-h-tl").value || 5),
      photoRows: Math.max(1, +$("#f-h-pr").value || 2),
      quoteRows: Math.max(1, +$("#f-h-qr").value || 1),
      wishCount: Math.max(2, +$("#f-h-wc").value || 8),
      showVideos: $("#f-h-videos").value,
      order: ($("#home-order").dataset.order || "timeline,photos,quotes,wishes,videos").split(","),
    };
    markDirty();
    toast("已写入待保存内容，点右上角「保存」导出");
  });

  /* ---------- 站点文本 ---------- */
  function renderTexts() {
    const t = (db.meta && db.meta.texts) || {};
    $("#text-list").innerHTML = Object.keys(t)
      .map(
        (k) => `<label class="field"><span class="text-key">${esc(k)}</span>
          <input data-tk="${esc(k)}" value="${esc(t[k])}" /></label>`
      )
      .join("");
  }
  $("#save-texts").addEventListener("click", () => {
    const t = {};
    document.querySelectorAll("[data-tk]").forEach((i) => (t[i.dataset.tk] = i.value));
    db.meta.texts = t;
    markDirty();
    toast("文本已写入待保存");
  });

  /* ---------- 通用列表（时间轴 / 随手记 / 心愿 / 事件） ---------- */
  const LIST_CFG = {
    timeline: { fields: [["date", "日期", "text"], ["title", "标题", "text"], ["text", "内容", "textarea"]] },
    quotes: { fields: [["text", "内容", "textarea"], ["tag", "署名", "text"]] },
    wishes: { fields: [["text", "愿望", "text"], ["emoji", "表情", "text"], ["done", "已解锁", "check"]] },
    events: { fields: [["date", "日期", "text"], ["title", "名称", "text"], ["note", "备注", "text"]] },
  };

  function renderList(key) {
    const cfg = LIST_CFG[key];
    const box = $("#list-" + key);
    const arr = db[key] || [];
    box.innerHTML = arr
      .map(
        (it, i) => `
      <div class="row" data-i="${i}">
        ${cfg.fields
          .map(([f, label, type]) => {
            if (type === "check")
              return `<label class="row-check"><input type="checkbox" data-f="${f}" ${it[f] ? "checked" : ""} />${label}</label>`;
            const v = esc(it[f] ?? "");
            return type === "textarea"
              ? `<label class="row-f"><span>${label}</span><textarea data-f="${f}" rows="2">${v}</textarea></label>`
              : `<label class="row-f"><span>${label}</span><input data-f="${f}" value="${v}" /></label>`;
          })
          .join("")}
        <button type="button" class="row-del" data-del="${i}" title="删除">✕</button>
      </div>`
      )
      .join("") || '<p class="modal__hint">还没有内容。</p>';
  }

  document.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.add;
      (db[key] = db[key] || []).push({});
      renderList(key);
      markDirty();
    });
  });

  document.querySelectorAll("[data-list]").forEach((box) => {
    const key = box.dataset.list;
    box.addEventListener("click", (e) => {
      const d = e.target.closest("[data-del]");
      if (!d) return;
      db[key].splice(+d.dataset.del, 1);
      renderList(key);
      markDirty();
    });
    box.addEventListener("input", () => markDirty());
  });

  document.querySelectorAll("[data-save-list]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.saveList;
      const cfg = LIST_CFG[key];
      const rows = [...document.querySelectorAll("#list-" + key + " .row")];
      db[key] = rows.map((r) => {
        const o = {};
        cfg.fields.forEach(([f, , type]) => {
          const n = r.querySelector(`[data-f="${f}"]`);
          if (!n) return;
          o[f] = type === "check" ? n.checked : n.value.trim();
        });
        return o;
      });
      markDirty();
      toast("已写入待保存");
    });
  });

  /* ---------- 照片库（改描述 / 地点 / 隐藏） ---------- */
  let photoView = "list";
  $("#photo-view")?.addEventListener("change", (e) => {
    photoView = e.target.value;
    renderPhotos();
  });

  function placeKey(p) {
    const pl = p.place || {};
    const parts = [pl.province, pl.city, pl.district, pl.spot].filter(Boolean);
    return parts.length ? parts.join("·") : "未标注地点";
  }

  function photoRow(p, i) {
    const pl = p.place || {};
    return `
      <div class="photo-row" data-i="${i}">
        <img loading="lazy" src="${esc(Site.imgSrc(p.src))}" alt="" />
        <div class="photo-row__grid">
          <label>描述<input data-p="title" value="${esc(p.title)}" /></label>
          <label>补充描述<textarea data-p="desc" rows="1">${esc(p.desc || "")}</textarea></label>
          <label>日期<input data-p="date" value="${esc(p.date)}" placeholder="2026-08-22" /></label>
          <label>省/市<span class="pair"><input data-p="province" value="${esc(pl.province || "")}" placeholder="省" /><input data-p="city" value="${esc(pl.city || "")}" placeholder="市" /></span></label>
          <label>区/地点<span class="pair"><input data-p="district" value="${esc(pl.district || "")}" placeholder="区县" /><input data-p="spot" value="${esc(pl.spot || "")}" placeholder="具体地点" /></span></label>
          <label class="row-check"><input type="checkbox" data-p="hidden" ${p.hidden ? "checked" : ""} />隐藏（不上照片墙）</label>
          <label class="row-check"><input type="checkbox" data-p="featured" ${p.featured ? "checked" : ""} />精选</label>
        </div>
      </div>`;
  }

  function renderPhotos() {
    const box = $("#photo-list");
    if (!box || !db) return;
    const kw = ($("#photo-search")?.value || "").trim().toLowerCase();
    const list = db.photos.filter(
      (p) => !kw || (p.file + " " + (p.title || "") + " " + placeKey(p)).toLowerCase().includes(kw)
    );
    if (photoView === "group") {
      const g = new Map();
      list.forEach((p) => {
        const k = placeKey(p);
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(p);
      });
      box.classList.add("is-group");
      box.innerHTML = [...g.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(
          ([k, arr]) => `
        <div class="pg-group">
          <div class="pg-head"><span class="pg-title">${esc(k)}</span>
            <span class="pg-count">${arr.length} 张</span></div>
          <div class="pg-grid">
            ${arr
              .map(
                (p) =>
                  `<figure class="pg-thumb ${p.hidden ? "is-hidden" : ""} ${p.featured ? "is-featured" : ""}"
                     data-file="${esc(p.file)}" title="${esc(p.title || p.file)}">
                     <img loading="lazy" src="${esc(Site.imgSrc(p.src))}" alt="" /></figure>`
              )
              .join("")}
          </div>
        </div>`
        )
        .join("");
    } else {
      box.classList.remove("is-group");
      const shown = list.slice(0, 60);
      box.innerHTML =
        shown.map((p, i) => photoRow(p, db.photos.indexOf(p))).join("") ||
        '<p class="modal__hint">没有匹配的照片。</p>';
      if (list.length > 60)
        box.innerHTML += `<p class="modal__hint">仅显示前 60 张（共 ${list.length} 张），用搜索框精确查找。</p>`;
    }
    $("#photo-stat").textContent = `共 ${db.photos.length} 张 · 当前匹配 ${list.length} 张`;
    markDirty();
  }

  $("#photo-search")?.addEventListener("input", renderPhotos);
  $("#photo-list")?.addEventListener("input", (e) => {
    const row = e.target.closest(".photo-row");
    if (!row) return;
    const p = db.photos[+row.dataset.i];
    const f = e.target.dataset.p;
    if (!p || !f) return;
    if (f === "hidden") p.hidden = e.target.checked;
    else if (f === "featured") p.featured = e.target.checked;
    else if (["province", "city", "district", "spot"].includes(f)) {
      p.place = p.place || {};
      p.place[f] = e.target.value.trim();
    } else p[f] = e.target.value;
    markDirty();
  });

  /* ---------- 保存：生成 content.json 供下载 ---------- */
  // 首页设置散在「基本信息」面板里，但用户常常改完行数就直接点右上角导出，
  // 不会去点「保存基本信息」。所以导出时统一冲一遍 DOM → db，避免白改。
  function syncFormToDb() {
    db.meta = db.meta || {};
    const num = (sel, def, min, max) => {
      const el = $(sel);
      const v = el ? Math.round(+el.value) : NaN;
      return Math.min(max, Math.max(min, Number.isFinite(v) && v > 0 ? v : def));
    };
    if ($("#f-anniversary")) db.meta.anniversary = $("#f-anniversary").value;
    if ($("#f-couple-a"))
      db.meta.couple = { a: $("#f-couple-a").value.trim(), b: $("#f-couple-b").value.trim() };
    if ($("#f-hero")) db.meta.hero = $("#f-hero").value.trim();
    if ($("#f-h-tl")) {
      db.meta.home = {
        timelineCount: num("#f-h-tl", 5, 1, 20),
        photoRows: num("#f-h-pr", 2, 1, 6),
        quoteRows: num("#f-h-qr", 1, 1, 6),
        wishCount: num("#f-h-wc", 8, 2, 30),
        showVideos: $("#f-h-videos") ? $("#f-h-videos").value : "auto",
        order: ($("#home-order").dataset.order || "timeline,photos,quotes,wishes,videos")
          .split(",")
          .filter(Boolean),
      };
    }
    const tk = document.querySelectorAll("[data-tk]");
    if (tk.length) {
      const t = { ...((db.meta && db.meta.texts) || {}) };
      tk.forEach((i) => (t[i.dataset.tk] = i.value));
      db.meta.texts = t;
    }
  }

  function buildContent() {
    syncFormToDb();
    const out = JSON.parse(JSON.stringify(db));
    out.version = 1;
    out.builtAt = localToday();
    return out;
  }

  $("#save-all").addEventListener("click", () => {
    const json = JSON.stringify(buildContent(), null, 1);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "content.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    dirty = false;
    $("#dirty-tip").hidden = true;
    toast("已导出 content.json，覆盖到 NAS 对应目录即可");
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- 启动 ---------- */
  if (getKey()) enter();
})();
