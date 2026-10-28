/* ============================================
   config.js —— 站点配置
   ============================================ */

/* ⓪ LeanCloud 云服务（★ 部署时由我填写 ★）
   appId / appKey：LeanCloud 控制台 → 应用设置 → 应用凭证
   adminTokenHash：管理密钥的 SHA-256（用于网页端鉴权） */
window.LC = {
  appId: "",          // ← 待填
  appKey: "",         // ← 待填
  adminTokenHash: "", // ← 待填（由管理密钥算出，不存明文）
};

/* ① 基本信息与时间轴（云上有内容时以云端为准，此处为默认值） */
window.SITE = {
  anniversary: "2022-05-20",   // 恋爱纪念日 YYYY-MM-DD
  timeline: [
    { date: "20XX.05.20", title: "第一次遇见你", text: "占位文案：写下那天在哪里、发生了什么。细节越具体，越耐看。" },
    { date: "20XX.06.01", title: "第一次约会",   text: "占位文案：一顿饭、一场电影，或者只是并肩走了很久。" },
    { date: "20XX.08.15", title: "第一次一起旅行", text: "占位文案：第一次旅行总是又慌张又开心，记得写下来。" },
    { date: "20XX.10.01", title: "在一起的第一百天", text: "占位文案：数字本身没什么意义，但和数字有关的人有。" },
  ],
};

/* ② 照片墙（内置基础照片；云端上传的照片会追加在前面） */
window.PHOTOS = [
  { src: "assets/photos/photo-01.jpg", title: "初见",           date: "20XX.05.20", portrait: true  },
  { src: "assets/photos/photo-02.jpg", title: "第一次旅行",     date: "20XX.06.18", portrait: false },
  { src: "assets/photos/photo-03.jpg", title: "一起吃的晚餐",   date: "20XX.07.02", portrait: false },
  { src: "assets/photos/photo-04.jpg", title: "雨天的伞",       date: "20XX.07.21", portrait: true  },
  { src: "assets/photos/photo-05.jpg", title: "夏天的海边",     date: "20XX.08.15", portrait: false },
  { src: "assets/photos/photo-06.jpg", title: "夜里的散步",     date: "20XX.09.03", portrait: true  },
  { src: "assets/photos/photo-07.jpg", title: "第一次看电影",   date: "20XX.09.20", portrait: false },
  { src: "assets/photos/photo-08.jpg", title: "生日惊喜",       date: "20XX.10.01", portrait: true  },
  { src: "assets/photos/photo-09.jpg", title: "秋天的公园",     date: "20XX.10.26", portrait: false },
  { src: "assets/photos/photo-10.jpg", title: "冬天的雪",       date: "20XX.12.11", portrait: true  },
  { src: "assets/photos/photo-11.jpg", title: "跨年夜",         date: "20XX.12.31", portrait: false },
  { src: "assets/photos/photo-12.jpg", title: "我们的日常",     date: "20XX.02.14", portrait: true  },
];

/* ③ 视频区（内置基础视频；云端上传的视频会追加在前面） */
window.VIDEOS = [
  { src: "assets/videos/clip-01.mp4", title: "我们的第一支短片", note: "占位：视频做好后放入 assets/videos/clip-01.mp4" },
  { src: "assets/videos/clip-02.mp4", title: "那年夏天的快剪",   note: "占位：视频做好后放入 assets/videos/clip-02.mp4" },
];
