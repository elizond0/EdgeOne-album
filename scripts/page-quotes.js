/* page-quotes.js —— 随手记子页：全量渲染 */
(function () {
  "use strict";
  document.addEventListener("site:ready", function (e) {
    const db = e.detail || {};
    Site.renderQuotes(document.getElementById("page-quotes"), db.quotes || []);
  });
})();
