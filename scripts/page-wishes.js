/* page-wishes.js —— 心愿单子页：TodoList 两栏（待解锁 / 已解锁） */
(function () {
  "use strict";
  document.addEventListener("site:ready", function (e) {
    const db = e.detail || {};
    Site.renderWishes(document.getElementById("page-wishes"), db.wishes || []);
  });
})();
