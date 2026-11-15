/* page-quotes.js —— 随手记子页：全量渲染 */
(function () {
  "use strict";
  document.addEventListener("site:ready", function (e) {
    const db = e.detail || {};
    const el = document.getElementById("page-quotes");
    const cfg = Site.pageCfg();
    if (el && cfg.quotesCols) el.dataset.cols = String(cfg.quotesCols);
    Site.renderQuotes(el, db.quotes || []);
  });
})();
