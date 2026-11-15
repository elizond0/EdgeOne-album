/* page-timeline.js —— 时间轴子页：全量渲染 */
(function () {
  "use strict";
  document.addEventListener("site:ready", function (e) {
    const db = e.detail || {};
    Site.renderTimeline(document.getElementById("page-timeline"), db.timeline || []);
  });
})();
