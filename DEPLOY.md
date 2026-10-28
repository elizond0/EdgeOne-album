# 部署到 EdgeOne Pages 指引

本目录是一个可直接部署到 EdgeOne Pages 的完整项目：
静态纪念册页面 + Node Functions API（`/api/*`）+ Blob 存储（照片视频与内容数据）。

## 部署前你只需要

1. 注册/登录腾讯云账号，开通 EdgeOne Pages（免费版）：<https://pages.edgeone.ai/zh>
2. 把本项目推到一个 GitHub 仓库（私有仓库即可）

## 方式 A：GitHub 导入（推荐，更新最方便）

1. 控制台 → 项目 → **导入 Git 仓库**，选择该仓库
2. 构建配置全部保持默认即可——项目根目录的 `edgeone.json` 已声明：
   - `installCommand: npm install`
   - `outputDirectory: ./`（仓库根目录即静态站）
   - Node 20.18.0
3. 点击部署，等待构建完成，得到 `xxx.edgeone.site`（或 `.edgeone.app`）预览域名

## 方式 B：EdgeOne CLI 命令行部署

```bash
npm i -g edgeone
edgeone login
# 在本项目目录下：
edgeone pages deploy
```

## 部署完成后的初始化（一次性）

1. 打开站点，点右上角 🔒，**首次输入的密钥（≥6 位）将成为管理密钥**，请牢记
2. 之后用该密钥解锁：上传照片/视频、编辑纪念日与时间轴、删除内容

## 数据都在哪里

| 内容 | 位置 | 说明 |
|---|---|---|
| 照片/视频文件 | Blob 命名空间 `album-media` | 浏览器预签名直传，单文件 ≤25MB |
| 纪念日/时间轴 JSON | Blob 命名空间 `album-data` | 控制台 Blob 页面可只读浏览 |
| 媒体索引、管理密钥哈希 | Blob 命名空间 `album-data` | 密钥只存 SHA-256 哈希 |

控制台 → 存储 → Blob 可查看和导出数据，建议重要节点手动导出备份。

## 日常更新

改了代码 → push 到 GitHub → EdgeOne 自动重新部署（函数和数据不受影响）。

## 限制备忘

- 免费版：Edge Functions 300 万次/月、KV/Blob 各 1GB、项目静态总存储 5GB
- Blob 单文件 ≤25MB（大视频请先压缩）
- 内容读取走最终一致（新上传的照片最长约几秒延迟在所有节点可见）
