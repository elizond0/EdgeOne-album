/* page-photos.js —— 照片墙子页：渲染 + 地点筛选
   本对话的决定：前台不再提供上传按钮，所有内容调整都在管理后台。
   因此这里只做展示与筛选。

   562 张全量渲染会让 DOM 涨到两千多个节点、页面高 8 万像素，
   所以分批铺：一次 photosPerBatch 张，滚到底再补下一批。
   列数由后台 meta.pages.photosCols 控制（1~4），手机上 3 列太挤就调 2。 */
(function () {
  "use strict";

  let all = [];
  let shown = 0;
  let list = [];
  let cfg = { photosCols: 3, photosPerBatch: 48 };

  function placeKey(p) {
    const pl = p.place || {};
    const parts = [pl.province, pl.city, pl.district, pl.spot].filter(Boolean);
    return parts.length ? parts.join("·") : "未标注地点";
  }

  function placeOptions() {
    const sel = document.getElementById("place-filter");
    if (!sel) return;
    const map = new Map();
    all.forEach((p) => {
      const k = placeKey(p);
      map.set(k, (map.get(k) || 0) + 1);
    });
    const keys = [...map.keys()].sort((a, b) => {
      if (a === "未标注地点") return 1;
      if (b === "未标注地点") return -1;
      return map.get(b) - map.get(a);
    });
    sel.innerHTML =
      '<option value="">全部地点（' + all.length + "）</option>" +
      keys.map((k) => `<option value="${Site.esc(k)}">${Site.esc(k)}（${map.get(k)}）</option>`).join("");
  }

  function syncMore() {
    const more = document.getElementById("wall-more");
    if (!more) return;
    const left = list.length - shown;
    more.hidden = left <= 0;
    const btn = more.querySelector("[data-wall-more]");
    if (btn) btn.textContent = "还有 " + left + " 张，继续加载 ↓";
  }

  function grow() {
    const wall = document.getElementById("wall");
    if (!wall || shown >= list.length) return false;
    const end = Math.min(list.length, shown + cfg.photosPerBatch);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.appendChild(Site.photoCard(list[i], i, list));
    wall.appendChild(frag);
    shown = end;
    syncMore();
    return shown < list.length;
  }

  function render() {
    const sel = document.getElementById("place-filter");
    const want = sel ? sel.value : "";
    list = want ? all.filter((p) => placeKey(p) === want) : all;

    const wall = document.getElementById("wall");
    wall.innerHTML = "";
    // 用 data-cols 而不是 inline style，这样窄屏的媒体查询还能盖住
    wall.dataset.cols = String(cfg.photosCols);
    shown = 0;

    const count = document.getElementById("wall-count");
    if (count) {
      count.textContent = want
        ? `${want} · ${list.length} 张（共 ${all.length} 张）`
        : `共 ${all.length} 张，按拍摄日期从新到旧`;
    }

    if (!list.length) {
      wall.innerHTML = '<p class="section__desc">这里还没有照片。</p>';
      syncMore();
      return;
    }
    grow();
  }

  document.addEventListener("site:ready", function () {
    all = Site.visiblePhotos();
    cfg = Site.pageCfg();
    placeOptions();
    render();

    const sel = document.getElementById("place-filter");
    if (sel) sel.addEventListener("change", render);

    const more = document.getElementById("wall-more");
    const btn = more && more.querySelector("[data-wall-more]");
    if (btn) btn.addEventListener("click", grow);

    // 滚到底自动补下一批；观察器只在状态变化时回调，补完要自己再看一次
    if (more && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (ens) =>
          ens.forEach((en) => {
            if (!en.isIntersecting) return;
            if (grow()) requestAnimationFrame(() => io.observe(more));
          }),
        { rootMargin: "400px 0px" }
      );
      io.observe(more);
    }
  });
})();
