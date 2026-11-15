/* ============================================
   main.js —— 渲染与交互
   职责：站点内容（纪念日/时间轴，云端优先）
         / 照片墙与影像（云端 + 本地合并）
         / 管理密钥登录 / 在线编辑面板 / 灯箱
   ============================================ */
(function () {
  "use strict";

  /* ---------- 0. 小工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const today = () =>
    new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

  const CS = window.CloudStore;

  /* 站点内容：先取 config.js 默认值，云端有则以云端为准 */
  let site = JSON.parse(JSON.stringify(window.SITE));

  /* ---------- 1. 相恋天数 ---------- */
  function renderDays() {
    const start = new Date(site.anniversary + "T00:00:00");
    const days = Math.max(0, Math.floor((Date.now() - start) / 86400000));
    $("#days-count").textContent = days.toLocaleString("zh-CN");
    $("#since-date").textContent = site.anniversary.replace(/-/g, ".");
    $("#since-year").textContent = site.anniversary.slice(0, 4);
  }

  /* ---------- 2. 时间轴 ---------- */
  function renderTimeline() {
    const list = $("#timeline-list");
    list.innerHTML = "";
    site.timeline.forEach((t, i) => {
      const item = el("li", "timeline__item reveal");
      item.style.setProperty("--reveal-delay", (i % 4) * 80 + "ms");
      item.innerHTML =
        '<span class="timeline__dot" aria-hidden="true"></span>' +
        '<p class="timeline__date">' + esc(t.date) + "</p>" +
        '<h3 class="timeline__title">' + esc(t.title) + "</h3>" +
        '<p class="timeline__text">' + esc(t.text) + "</p>";
      list.appendChild(item);
      observeReveal(item);
    });
  }

  /* ---------- 3. 照片墙 ---------- */
  let photoItems = []; // { src, title, date, delObj?|delId? }

  function renderWall(cloudMedia, localMedia) {
    const grid = $("#wall-grid");
    grid.innerHTML = "";
    photoItems = [];

    // 顺序：云端照片（新在前）→ 本地设备照片 → 内置照片
    if (CS.state.cloudReady) {
      cloudMedia.filter((m) => m.kind === "photo").forEach((m) => {
        const item = { src: m.url, title: m.name, date: m.date, delObj: m };
        photoItems.push(item);
        grid.appendChild(makePhotoCard(item, m.id, false));
      });
    }
    localMedia.filter((m) => m.kind === "photo").forEach((m) => {
      const item = { src: URL.createObjectURL(m.blob), title: m.name, date: m.date, delId: m.id };
      photoItems.push(item);
      grid.appendChild(makePhotoCard(item, m.id, true));
    });
    window.PHOTOS.forEach((p) => {
      const item = { src: p.src, title: p.title, date: p.date };
      photoItems.push(item);
      grid.appendChild(makePhotoCard(item, null, false));
    });
  }

  function makePhotoCard(item, uploadKey, local) {
    const node = el("button", "wall__item reveal");
    node.type = "button";
    node.setAttribute("aria-label", "查看照片：" + item.title);
    const card = el("div", "polaroid");
    card.innerHTML =
      '<span class="tape" aria-hidden="true"></span>' +
      '<img class="polaroid__img" loading="lazy" src="' + esc(item.src) + '" alt="' + esc(item.title) + '" />' +
      '<p class="polaroid__caption">' + esc(item.title) +
      (item.date ? '<span class="polaroid__date">' + esc(item.date) + "</span>" : "") +
      "</p>";
    node.appendChild(card);
    node.addEventListener("click", () => {
      const i = photoItems.findIndex((p) => p.src === item.src);
      openLightbox(i >= 0 ? i : 0);
    });
    if (uploadKey) node.appendChild(makeDelBtn(item, uploadKey, local));
    return node;
  }

  /* 删除角标：仅管理模式可见 */
  function makeDelBtn(item, key, local) {
    const btn = el("button", "del-btn admin-only");
    btn.type = "button";
    btn.hidden = !CS.state.admin;
    btn.setAttribute("aria-label", "删除");
    btn.textContent = "✕";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除《" + item.title + "》？此操作所有人可见且不可恢复。")) return;
      try {
        if (local) { await dbDelete(key); }
        else { await CS.deleteMedia(item.delObj); }
        renderAll();
      } catch (err) {
        alert("删除失败：" + (err.message || err));
      }
    });
    return btn;
  }

  /* ---------- 4. 灯箱 ---------- */
  const lb = $("#lightbox");
  let lbIndex = 0;

  function openLightbox(i) {
    lbIndex = i;
    updateLightbox();
    lb.hidden = false;
    requestAnimationFrame(() => lb.classList.add("open"));
    $("#lb-close").focus();
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => { lb.hidden = true; }, 300);
  }
  function updateLightbox() {
    const p = photoItems[lbIndex];
    if (!p) return;
    $("#lb-img").src = p.src;
    $("#lb-img").alt = p.title;
    $("#lb-caption").textContent = p.title + (p.date ? " · " + p.date : "");
  }
  $("#lb-close").addEventListener("click", closeLightbox);
  $("#lb-prev").addEventListener("click", () => stepLightbox(-1));
  $("#lb-next").addEventListener("click", () => stepLightbox(1));
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") stepLightbox(-1);
    if (e.key === "ArrowRight") stepLightbox(1);
  });
  function stepLightbox(dir) {
    if (!photoItems.length) return;
    lbIndex = (lbIndex + dir + photoItems.length) % photoItems.length;
    updateLightbox();
  }

  /* ---------- 5. 影像区 ---------- */
  function renderVideos(cloudMedia, localMedia) {
    const grid = $("#videos-grid");
    grid.innerHTML = "";
    if (CS.state.cloudReady) {
      cloudMedia.filter((m) => m.kind === "video").forEach((m, i) => {
        grid.appendChild(makeVideoCard({ src: m.url, title: m.name, note: "", delObj: m }, m.id, i, false));
      });
    }
    localMedia.filter((m) => m.kind === "video").forEach((m, i) => {
      grid.appendChild(makeVideoCard({
        src: URL.createObjectURL(m.blob), title: m.name, note: "本设备", delId: m.id,
      }, m.id, i, true));
    });
    window.VIDEOS.forEach((v, i) => {
      grid.appendChild(makeVideoCard({ ...v, poster: "assets/videos/poster.jpg" }, null, i, false));
    });
  }

  function makeVideoCard(v, uploadKey, i, local) {
    const card = el("article", "video-card reveal");
    card.style.setProperty("--reveal-delay", (i % 3) * 100 + "ms");
    const frame = el("div", "video-card__frame");
    frame.innerHTML =
      '<video controls preload="metadata"' + (v.poster ? ' poster="' + esc(v.poster) + '"' : "") + ">" +
      '<source src="' + esc(v.src) + '" /></video>';
    const video = frame.querySelector("video");
    if (v.note) {
      const fallback = el("div", "video-card__fallback", "🎬<br />" + esc(v.note));
      frame.appendChild(fallback);
      video.addEventListener("loadeddata", () => fallback.remove());
      video.addEventListener("error", () => video.removeAttribute("controls"));
    }
    card.appendChild(frame);
    card.appendChild(el("div", "video-card__body",
      '<h3 class="video-card__title">' + esc(v.title) + "</h3>"));
    if (uploadKey) card.appendChild(makeDelBtn(v, uploadKey, local));
    observeReveal(card);
    return card;
  }

  /* ---------- 6. 上传（云端优先，未配置则落本地）---------- */
  async function handleUpload(files, kind) {
    if (CS.state.cloudReady && CS.state.admin) {
      // 云上传：所有人可见
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, "");
        try {
          $("#uploading-tip").hidden = false;
          await CS.uploadMedia(kind, file, name, today());
        } catch (err) {
          alert("云端上传失败，已改为保存本设备：" + (err.message || err));
          await dbPut({ id: crypto.randomUUID(), kind, name, date: today(), blob: file });
        }
      }
      $("#uploading-tip").hidden = true;
    } else if (!CS.state.cloudReady) {
      // 云未配置：本地兜底（仅本设备）
      for (const file of files) {
        await dbPut({ id: crypto.randomUUID(), kind, name: file.name.replace(/\.[^.]+$/, ""), date: today(), blob: file });
      }
    }
    renderAll();
  }

  function bindUpload(btnId, inputId, kind) {
    const input = $(inputId);
    $(btnId).addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files.length) handleUpload([...input.files], kind);
      input.value = "";
    });
  }

  /* ---------- 7. 管理模式 ---------- */
  function applyAdminUI() {
    const admin = CS.state.admin;
    document.querySelectorAll(".admin-only").forEach((n) => { n.hidden = !admin; });
    $("#admin-btn").textContent = admin ? "🔓" : "🔒";
    $("#admin-btn").title = admin ? "Alt+点击打开编辑面板" : "管理入口";
  }

  $("#admin-btn").addEventListener("click", (e) => {
    e.preventDefault();
    // 管理模式 + Alt 点击 → 打开内容编辑面板
    if (e.altKey && CS.state.admin) { openEditor(); return; }
    // 管理模式普通点击 → 退出管理
    if (CS.state.admin) {
      CS.logoutAdmin();
      applyAdminUI();
      renderAll();
      return;
    }
    if (!CS.state.cloudReady) { alert("云端不可用（本机预览模式），管理功能需部署到 EdgeOne 后使用。"); return; }
    $("#token-modal").hidden = false;
    $("#token-input").focus();
  });
  $("#token-cancel").addEventListener("click", () => { $("#token-modal").hidden = true; });
  $("#token-ok").addEventListener("click", async () => {
    const ok = await CS.loginAdmin($("#token-input").value);
    if (ok) {
      $("#token-modal").hidden = true;
      $("#token-error").hidden = true;
      $("#token-input").value = "";
      applyAdminUI();
      renderAll();
    } else {
      $("#token-error").hidden = false;
    }
  });
  $("#token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#token-ok").click();
  });

  /* ---------- 8. 在线编辑面板 ---------- */
  const modal = $("#edit-modal");

  function timelineRow(item) {
    const row = el("div", "edit-row");
    row.innerHTML =
      '<input class="row-date" type="text" placeholder="日期 如 2024.05.20" value="' + esc(item.date) + '" />' +
      '<input class="row-title" type="text" placeholder="标题" value="' + esc(item.title) + '" />' +
      '<textarea class="row-text" placeholder="想记录的话" rows="2">' + esc(item.text) + "</textarea>";
    const del = el("button", "row-del");
    del.type = "button"; del.textContent = "✕"; del.title = "删除此节点";
    del.addEventListener("click", () => row.remove());
    row.appendChild(del);
    return row;
  }

  function openEditor() {
    $("#edit-anniversary").value = site.anniversary;
    const wrap = $("#edit-timeline");
    wrap.innerHTML = "";
    site.timeline.forEach((t) => wrap.appendChild(timelineRow(t)));
    $("#edit-error").hidden = true;
    modal.hidden = false;
  }

  $("#edit-add").addEventListener("click", () => {
    $("#edit-timeline").appendChild(timelineRow({ date: "", title: "", text: "" }));
  });
  $("#edit-cancel").addEventListener("click", () => { modal.hidden = true; });
  $("#edit-save").addEventListener("click", async () => {
    const rows = [...document.querySelectorAll("#edit-timeline .edit-row")];
    const tl = rows.map((r) => ({
      date: r.querySelector(".row-date").value.trim(),
      title: r.querySelector(".row-title").value.trim(),
      text: r.querySelector(".row-text").value.trim(),
    })).filter((t) => t.title);
    const data = { anniversary: $("#edit-anniversary").value || site.anniversary, timeline: tl };
    try {
      await CS.saveContent(data);
      site = data;
      renderDays();
      renderTimeline();
      modal.hidden = true;
    } catch (err) {
      const box = $("#edit-error");
      box.textContent = "保存失败：" + (err.message || err);
      box.hidden = false;
    }
  });

  /* ---------- 9. 本地 IndexedDB（云端未配置时的兜底）---------- */
  const DB_NAME = "love-album";
  const STORE = "media";
  let dbPromise = null;

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function dbAll() {
    try {
      const db = await openDB();
      return await new Promise((res, rej) => {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (_) { return []; }
  }
  async function dbPut(item) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }

  /* ---------- 10. 滚动入场 ---------- */
  let revealIO = null;
  function observeReveal(node) {
    if (!revealIO) {
      revealIO = new IntersectionObserver(
        (entries) => entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add("in"); revealIO.unobserve(en.target); }
        }),
        { threshold: 0.12 }
      );
    }
    revealIO.observe(node);
  }

  /* ---------- 启动 ---------- */
  async function renderAll() {
    let cloudMedia = [];
    // 优先从 NAS 隧道读取媒体清单（图片/视频已迁出 Blob 存储）
    if (window.NAS && window.NAS.load) {
      await window.NAS.load();
      if (window.NAS.ready) {
        window.PHOTOS = window.NAS.photos;
        if (window.NAS.videos.length) window.VIDEOS = window.NAS.videos;
      }
    }
    const localMedia = await dbAll();
    if (CS.state.cloudReady) {
      try { cloudMedia = await CS.listMedia(); }
      catch (e) { console.error("云端媒体读取失败", e); }
    }
    renderWall(cloudMedia, localMedia);
    renderVideos(cloudMedia, localMedia);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    // 探测云端（EdgeOne /api）是否可用，不可用则本机模式
    await CS.detect();
    CS.restoreAdmin();
    bindUpload("#upload-photo-btn", "#upload-photo-input", "photo");
    bindUpload("#upload-video-btn", "#upload-video-input", "video");
    applyAdminUI();

    // 云端内容优先
    if (CS.state.cloudReady) {
      try {
        const data = await CS.loadContent();
        if (data) site = { ...site, ...data };
      } catch (e) { console.error("云端内容读取失败", e); }
    }
    renderDays();
    renderTimeline();
    await renderAll();

    // 上传中提示
    const tip = el("p", "form__hint", "正在上传到云端…");
    tip.id = "uploading-tip";
    tip.hidden = true;
    document.querySelector("main").prepend(tip);
  });
})();
