/* ============================================
   nas.js —— NAS 媒体清单加载层
   作用：读取站点根目录 base.json 拿到当前隧道地址，
        再读取该地址下的 index.json，得到全部照片/视频直链。
   用法：页面脚本里 await window.NAS.load()，
        成功后 window.NAS.photos / window.NAS.videos 即为可渲染数组。
   ============================================ */
(function () {
  "use strict";

  const NAS = { base: "", ready: false, photos: [], videos: [], error: "" };
  window.NAS = NAS;

  const fmtDate = (d) => String(d || "").replace(/-/g, ".");

  NAS.load = async function () {
    try {
      const br = await fetch("base.json?_=" + Date.now(), { cache: "no-store" });
      if (!br.ok) throw new Error("base.json HTTP " + br.status);
      const bj = await br.json();
      NAS.base = String(bj.base || "").replace(/\/+$/, "");
      if (!NAS.base) throw new Error("base.json 里没有 base 字段");

      const ir = await fetch(NAS.base + "/index.json?_=" + Date.now(), {
        cache: "no-store",
      });
      if (!ir.ok) throw new Error("index.json HTTP " + ir.status);
      const idx = await ir.json();
      const items = Array.isArray(idx.items) ? idx.items : [];

      for (const x of items) {
        if (!x || !x.f) continue;
        const src = NAS.base + "/" + x.f;
        if (x.k === "video") {
          NAS.videos.push({
            src,
            title: String(x.f).split("/").pop(),
            note: "",
          });
        } else {
          NAS.photos.push({ src, title: "", date: fmtDate(x.d) });
        }
      }
      NAS.ready = NAS.photos.length > 0 || NAS.videos.length > 0;
    } catch (e) {
      NAS.error = String(e && e.message ? e.message : e);
      console.warn("[NAS] 媒体清单加载失败：", NAS.error);
    }
    return NAS;
  };
})();
