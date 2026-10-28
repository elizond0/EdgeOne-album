/* ============================================
   cloud-functions/api/[[default]].js
   恋爱纪念册 API（Express，Node.js 20）
   挂载于站点 /api/* 路由。

   存储：
   - 照片/视频文件 → Blob "album-media"
   - 内容(纪念日/时间轴) + 媒体索引 + 管理密钥哈希 → Blob "album-data"

   鉴权：管理密钥仅在首次设置时确定，之后只存
   SHA-256 哈希；每次写操作都需携带 x-admin-token 头。
   ============================================ */
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { getStore } from "@edgeone/pages-blob";

const app = express();
app.use(express.json({ limit: "2mb" }));

const MEDIA = getStore("album-media");   // 文件
const DATA = getStore({ name: "album-data", consistency: "strong" }); // 元数据

/* ---------- 小工具 ---------- */
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const json = (res, code, obj) =>
  res.status(code).json(obj);

async function requireAdmin(req, res, next) {
  const token = req.get("x-admin-token") || "";
  const hash = await DATA.get("adminhash");
  if (!hash) return json(res, 409, { error: "尚未设置管理密钥，请先完成初始化" });
  if (sha256(token) !== hash) return json(res, 401, { error: "管理密钥不正确" });
  next();
}

async function readIndex() {
  const list = await DATA.get("media-index", { type: "json" });
  return Array.isArray(list) ? list : [];
}
async function writeIndex(list) {
  await DATA.setJSON("media-index", list);
}

/* ---------- 健康检查 / 鉴权 ---------- */
app.get("/", async (req, res) => {
  const configured = !!(await DATA.get("adminhash"));
  json(res, 200, { ok: true, service: "love-album-api", configured });
});

// 首次初始化：设置管理密钥（仅未配置时可用）
app.post("/admin/setup", async (req, res) => {
  const { token } = req.body || {};
  if (!token || String(token).length < 6) {
    return json(res, 400, { error: "密钥至少 6 位" });
  }
  if (await DATA.get("adminhash")) {
    return json(res, 409, { error: "管理密钥已设置过，不能重复设置" });
  }
  await DATA.set("adminhash", sha256(token));
  json(res, 200, { ok: true, configured: true });
});

// 登录：校验密钥（每次写操作也会再验一次）
app.post("/admin/login", async (req, res) => {
  const { token } = req.body || {};
  const hash = await DATA.get("adminhash");
  if (!hash) return json(res, 409, { error: "尚未设置管理密钥" });
  if (sha256(token || "") !== hash) return json(res, 401, { error: "密钥不正确" });
  json(res, 200, { ok: true });
});

/* ---------- 站点内容（纪念日 + 时间轴）---------- */
app.get("/content", async (req, res) => {
  const data = await DATA.get("content", { type: "json" });
  json(res, 200, { data: data || null });
});

app.post("/content", requireAdmin, async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object") return json(res, 400, { error: "缺少内容数据" });
  await DATA.setJSON("content", data);
  json(res, 200, { ok: true });
});

/* ---------- 媒体（照片/视频）---------- */
// 列表：返回媒体索引（新添加的在前）
app.get("/media", async (req, res) => {
  json(res, 200, { media: await readIndex() });
});

// 签发直传 URL：浏览器直接 PUT 文件到 Blob，不经过函数
app.post("/upload-url", requireAdmin, async (req, res) => {
  const { name, contentType } = req.body || {};
  if (!name) return json(res, 400, { error: "缺少文件名" });
  const safeName = String(name).replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const key = `media/${randomUUID()}-${safeName}`;
  const { url, expiresAt } = await MEDIA.createUploadUrl(key, {
    expireSeconds: 600,
    contentType: contentType || "application/octet-stream",
  });
  json(res, 200, { url, key, expiresAt });
});

// 登记媒体元数据（直传完成后调用）
app.post("/media", requireAdmin, async (req, res) => {
  const { key, name, kind, date } = req.body || {};
  if (!key || !name || !["photo", "video"].includes(kind)) {
    return json(res, 400, { error: "参数不完整" });
  }
  const list = await readIndex();
  const id = randomUUID();
  list.unshift({ id, key, name: String(name).slice(0, 60), kind, date: date || "", createdAt: Date.now() });
  await writeIndex(list.slice(0, 2000));
  json(res, 200, { ok: true, id });
});

// 删除媒体：索引 + 文件一起删
app.delete("/media/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const list = await readIndex();
  const item = list.find((m) => m.id === id);
  if (!item) return json(res, 404, { error: "条目不存在" });
  await MEDIA.delete(item.key).catch(() => {});
  await writeIndex(list.filter((m) => m.id !== id));
  json(res, 200, { ok: true });
});

/* ---------- 文件输出 ---------- */
// 通过函数输出 Blob 文件（附带缓存头，浏览器侧缓存一天）
app.get("/file/*", async (req, res) => {
  const key = decodeURIComponent(req.params[0] || "");
  if (!key.startsWith("media/")) return json(res, 403, { error: "非法路径" });
  const result = await MEDIA.getWithHeaders(key);
  if (!result || result.body == null) return json(res, 404, { error: "文件不存在" });
  res.status(200);
  res.set("Content-Type", result.headers["content-type"] || "application/octet-stream");
  res.set("Cache-Control", "public, max-age=86400");
  Readable.fromWeb(result.body).pipe(res);
});

app.use((req, res) => json(res, 404, { error: "接口不存在" }));

export default app;
