/* ============================================
   api.js —— 云端能力层（EdgeOne Pages 版）
   后端：/api/*（Node Functions + Blob 存储）
   职责：健康探测 / 管理密钥（首次设置+登录）
         / 媒体直传与列表删除 / 站点内容读写
   ============================================ */
(function () {
  "use strict";

  const state = { cloudReady: false, admin: false };
  let adminToken = sessionStorage.getItem("album-admin") || "";

  const CS = { state };
  window.CloudStore = CS;

  /* ---------- 健康探测：/api 可用即云端就绪 ---------- */
  CS.detect = async function () {
    try {
      const r = await fetch("/api/", { cache: "no-store" });
      const j = await r.json();
      state.cloudReady = !!j.ok;
      state.configured = !!j.configured;
    } catch (_) {
      state.cloudReady = false; // 静态预览环境 → 本机模式
    }
    return state.cloudReady;
  };

  /* ---------- 鉴权 ---------- */
  // 首次使用：输入的密钥直接成为管理密钥；之后为登录校验
  CS.loginAdmin = async function (token) {
    token = String(token || "").trim();
    if (token.length < 6) return false;
    let r = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (r.status === 409) {
      // 尚未设置 → 本次输入即初始化
      r = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    }
    if (!r.ok) return false;
    adminToken = token;
    sessionStorage.setItem("album-admin", token);
    state.admin = true;
    return true;
  };
  CS.restoreAdmin = function () {
    if (adminToken && sessionStorage.getItem("album-admin") === adminToken) state.admin = true;
  };
  CS.logoutAdmin = function () {
    state.admin = false;
    adminToken = "";
    sessionStorage.removeItem("album-admin");
  };

  /* ---------- 媒体 ---------- */
  CS.listMedia = async function () {
    const r = await fetch("/api/media", { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.media || []).map((m) => ({ ...m, url: "/api/file/" + m.key }));
  };

  // 直传：签 URL → 浏览器 PUT → 登记元数据
  CS.uploadMedia = async function (kind, file, name, date) {
    const u = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ name: file.name, contentType: file.type }),
    });
    if (!u.ok) throw new Error((await u.json().catch(() => ({}))).error || "签发上传地址失败");
    const { url, key } = await u.json();

    const put = await fetch(url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!put.ok) throw new Error("文件上传失败（" + put.status + "）");

    const reg = await fetch("/api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ key, name, kind, date }),
    });
    if (!reg.ok) throw new Error("登记失败：" + (await reg.json().catch(() => ({}))).error);
  };

  CS.deleteMedia = async function (item) {
    const r = await fetch("/api/media/" + item.id, {
      method: "DELETE",
      headers: { "x-admin-token": adminToken },
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "删除失败");
  };

  /* ---------- 站点内容 ---------- */
  CS.loadContent = async function () {
    const r = await fetch("/api/content", { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data || null;
  };
  CS.saveContent = async function (data) {
    const r = await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
      body: JSON.stringify({ data }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "保存失败");
  };
})();
