/* page-photos.js —— 照片墙子页：渲染 + 地点筛选
   本对话的决定：前台不再提供上传按钮，所有内容调整都在管理后台。
   因此这里只做展示与筛选。 */
(function () {
  "use strict";

  let all = [];

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

  function render() {
    const sel = document.getElementById("place-filter");
    const want = sel ? sel.value : "";
    const list = want ? all.filter((p) => placeKey(p) === want) : all;
    const wall = document.getElementById("wall");
    wall.innerHTML = "";
    list.forEach((p, i) => wall.appendChild(Site.photoCard(p, i, list)));

    const count = document.getElementById("wall-count");
    if (count) {
      count.textContent = want
        ? `${want} · ${list.length} 张（共 ${all.length} 张）`
        : `共 ${all.length} 张，按拍摄日期从新到旧`;
    }
    if (!list.length) {
      wall.innerHTML = '<p class="section__desc">这里还没有照片。</p>';
    }
  }

  document.addEventListener("site:ready", function () {
    all = Site.visiblePhotos();
    placeOptions();
    render();
    const sel = document.getElementById("place-filter");
    if (sel) sel.addEventListener("change", render);
  });
})();
