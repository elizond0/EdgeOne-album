/* page-videos.js —— 影像子页
   上传入口只在管理后台；前台纯展示。
   内容来自 NAS 清单里的 video 项（content.json 的 videos）。 */
(function () {
  "use strict";
  document.addEventListener("site:ready", function (e) {
    const db = e.detail || {};
    const box = document.getElementById("page-videos");
    const list = db.videos || [];
    if (!list.length) {
      box.innerHTML =
        '<p class="section__desc" style="color:#b8b1a2">还没有短片。管理后台「媒体文件」里可以上传。</p>';
      return;
    }
    Site.renderVideos(box, list);
  });
})();
