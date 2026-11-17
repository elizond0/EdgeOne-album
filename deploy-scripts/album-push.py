#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
album-push.py —— 相册后台的写入口（NAS 侧哑管道）

职责只有六件事，不含任何业务规则（归类和文案都在前端 admin.js 里）：
  ⓪ 发令牌        POST /api/auth  校验口令，发一个短效令牌（进后台用）
  ① 验口令        PBKDF2-HMAC-SHA256（pbkdf2$轮数$盐$dk），常数时间比较
  ② 验请求        体积 ≤2MB、JSON 可解析、顶层 key 白名单
  ③ 验文件        照片文件名在 /srv/pub/img 下真的存在（防死链）
  ④ 存档         旧版 content.json 存 /var/lib/tailscale/history/
  ⑤ 提交          PUT 到 GitHub，用 NAS 本地的 .gh_token

口令为什么用 PBKDF2：口令只有 6 位数字，10^6 个候选空间。老格式是
sha256(盐+口令)——单卡一秒能算几千万次，拿到 push-secret 就等于拿到口令。
PBKDF2 20 万轮把单次校验拖到 ~50ms，爆破成本抬到万倍级，仍不影响正常使用。
push-secret 里同时兼容老格式（盐:sha256），下次 --set-key 自动升级成新格式。

为什么要有这一层（而不是浏览器直接连 GitHub）：
  - token 不进浏览器。浏览器泄漏最多丢一个口令，丢不了仓库写权限
  - 攻击面收窄到「只能改 data/content.json」一个文件，改不了 index.html
  - 服务端能挡掉「照片数骤降」「文件名不存在」这类前端 bug

用法：
  python3 album-push.py --set-key '<口令>'     # 生成/重置口令（写 push-secret）
  python3 album-push.py --check                # 看一眼口令/token 有没有
  python3 album-push.py                        # 前台运行，监听 8787
接口：
  GET  /api/health   存活 + 有没有设过口令
  POST /api/auth     {key} → {ok, token, ttl}   进后台的令牌（默认 12 小时）
  POST /api/save     需 X-Admin-Auth 或 X-Admin-Key
  POST /api/pull|run 运维，需 X-Admin-Key
环境变量：
  ALBUM_PUSH_PORT   默认 8787
  ALBUM_PUSH_ROOT   静态根目录，默认 /srv/pub
  ALBUM_HOME        状态目录，默认 /var/lib/tailscale
  ALBUM_REPO        默认 elizond0/album
  ALBUM_ALLOW_ORIGIN  默认 https://elizond0.github.io
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("ALBUM_PUSH_PORT", "8787"))
ROOT = Path(os.environ.get("ALBUM_PUSH_ROOT", "/srv/pub"))
HOME = Path(os.environ.get("ALBUM_HOME", "/var/lib/tailscale"))
REPO = os.environ.get("ALBUM_REPO", "elizond0/album")
ORIGIN = os.environ.get("ALBUM_ALLOW_ORIGIN", "https://elizond0.github.io")
FILE_PATH = "data/content.json"
BRANCH = "main"

SECRET_F = HOME / "push-secret"
TOKEN_F = HOME / ".gh_token"
HIST_DIR = HOME / "history"
LOG_F = HOME / "album-push.log"

MAX_BODY = 2 * 1024 * 1024
TOP_KEYS = {"version", "builtAt", "base", "meta", "events", "timeline", "quotes", "wishes", "photos", "videos"}
RATE_WINDOW = 60
RATE_MAX = 5            # 单 IP 每分钟 5 次（正常改文案根本用不到）
RATE_GLOBAL_MAX = 15    # 全局每分钟 15 次
DROP_RATIO = 0.95       # 照片数掉到上次的 95% 以下就拒

# 口令哈希：pbkdf2$<轮数>$<盐 hex>$<dk hex>
PBKDF2_ITER = 200_000
TOKEN_TTL = 12 * 3600   # 进后台的令牌有效期，够一个下午改文案
TOKEN_MAX = 200         # 内存里最多留多少个令牌，超了先丢最老的

_hits = {}              # ip -> [ts, ...]
_g_hits = deque()       # 全局时间戳队列
_tokens = {}            # token -> 过期时间戳
_auth_fail = deque()    # 全局鉴权失败时间戳，用于「口令被爆破」刹车
AUTH_FAIL_MAX = 12      # 一分钟内全局失败 12 次就短暂停止受理校验


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_F, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        if LOG_F.stat().st_size > 400_000:          # 别无限长
            lines = LOG_F.read_text(encoding="utf-8").splitlines()[-2000:]
            LOG_F.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        pass


def load_secret():
    """返回 push-secret 里的原始字符串；文件不存在/为空返回 ""。"""
    try:
        return SECRET_F.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def make_secret(key: str, iter_: int = PBKDF2_ITER):
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", key.encode("utf-8"), salt, iter_, dklen=32)
    HOME.mkdir(parents=True, exist_ok=True)
    SECRET_F.write_text(f"pbkdf2${iter_}${salt.hex()}${dk.hex()}\n", encoding="utf-8")
    os.chmod(SECRET_F, 0o600)
    return SECRET_F


def check_key(key: str) -> bool:
    """常数时间比对。兼容老的 `盐:sha256` 格式，升级靠下次 --set-key。"""
    raw = load_secret()
    if not raw or not key:
        return False
    if raw.startswith("pbkdf2$"):
        try:
            _, iter_s, salt_hex, dk_hex = raw.split("$", 3)
            dk = hashlib.pbkdf2_hmac(
                "sha256", key.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s), dklen=32
            )
            return hmac.compare_digest(dk.hex(), dk_hex)
        except (ValueError, TypeError):
            return False
    try:
        salt, want = raw.split(":", 1)
    except ValueError:
        return False
    got = hashlib.sha256((salt + key).encode("utf-8")).hexdigest()
    return hmac.compare_digest(got, want)


def note_fail():
    """记一次口令失败；调用方据此判断要不要刹车。"""
    now = time.time()
    while _auth_fail and now - _auth_fail[0] > RATE_WINDOW:
        _auth_fail.popleft()
    _auth_fail.append(now)
    return len(_auth_fail)


def auth_braked() -> bool:
    now = time.time()
    while _auth_fail and now - _auth_fail[0] > RATE_WINDOW:
        _auth_fail.popleft()
    return len(_auth_fail) >= AUTH_FAIL_MAX


def issue_token() -> str:
    now = time.time()
    for t, exp in list(_tokens.items()):          # 顺手清过期
        if exp < now:
            _tokens.pop(t, None)
    while len(_tokens) >= TOKEN_MAX:              # 超量先踢最老的
        _tokens.pop(next(iter(_tokens)), None)
    tok = secrets.token_urlsafe(32)
    _tokens[tok] = now + TOKEN_TTL
    return tok


def check_token(tok: str) -> bool:
    if not tok:
        return False
    exp = _tokens.get(tok)
    if not exp:
        return False
    if exp < time.time():
        _tokens.pop(tok, None)
        return False
    return True


def gh(path, method="GET", body=None, timeout=90):
    token = TOKEN_F.read_text(encoding="utf-8").strip()
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "album-push",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def remote_sha():
    """trees 接口只回目录清单（几百字节，0.6s）；contents 要下整个 316KB（9s）。"""
    try:
        s, j = gh(f"/git/trees/{BRANCH}:data", timeout=20)
        if s == 200:
            for x in j.get("tree", []):
                if x.get("path") == "content.json":
                    return x.get("sha")
    except Exception as e:
        log(f"trees 失败，回退 contents: {type(e).__name__}")
    s, j = gh(f"/contents/{FILE_PATH}?ref={BRANCH}")
    return j.get("sha")


def archive(old_bytes: bytes):
    try:
        HIST_DIR.mkdir(parents=True, exist_ok=True)
        name = time.strftime("content-%Y%m%d-%H%M%S.json")
        (HIST_DIR / name).write_bytes(old_bytes)
        files = sorted(HIST_DIR.glob("content-*.json"))
        for f in files[:-30]:                       # 只留最近 30 份
            f.unlink()
        return name
    except OSError as e:
        log(f"存档失败（不阻断）: {e}")
        return ""


def check_photos(doc):
    """照片数不能骤降 + 文件名必须真的在 /srv/pub/img 下。返回错误信息或 None。"""
    photos = doc.get("photos")
    if not isinstance(photos, list) or not photos:
        return "photos 为空，拒绝提交（防止误把内容清空）"

    img = ROOT / "img"
    missing = []
    for p in photos:
        f = str(p.get("file") or "").replace("img/", "", 1)
        if not f:
            missing.append("(空文件名)")
            continue
        # 视频条目混在 photos 里时 file 形如 video/xxx.mp4，不能拿 img/ 去找。
        # 2026-11-16 实测：photos 562 条里没有 .mp4，但前端一旦允许把视频并入
        # photos，这条路径就会把所有视频判成「照片不存在」并 422。
        target = (ROOT / f) if f.startswith("video/") else (img / f)
        if not target.exists():
            missing.append(f)
        if len(missing) > 5:
            break
    if missing:
        return "这些照片文件在 NAS 上不存在：" + ", ".join(missing[:5])

    # 与上一次提交的数量比
    try:
        s, j = gh(f"/contents/{FILE_PATH}?ref={BRANCH}")
        old = json.loads(base64.b64decode(j["content"]))
        before = len(old.get("photos") or [])
        now = len(photos)
        if before and now < before * DROP_RATIO:
            return f"照片数从 {before} 掉到 {now}，超过 5% 阈值，拒绝提交"
    except Exception as e:
        log(f"数量比对跳过: {type(e).__name__}")
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "album-push/1.0"

    def _cors(self):
        # CORS 头一律由 Caddy 发（Caddyfile 里那几行）。
        # 这里再发一次会变成 "*, https://elizond0.github.io" 两个值，
        # 浏览器直接判 CORS 失败——实测就是这么挂的，改完 header 只剩一个值才通。
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def client_ip(self):
        # 隧道后面全是 127.0.0.1，必须读 cloudflared 注入的真实 IP
        return self.headers.get("CF-Connecting-IP") or self.client_address[0]

    def limited(self):
        now = time.time()

        # 全局闸门先判：出口 IP 可能是代理池（云沙箱、手机流量都会轮换），
        # 只按 IP 限速等于没限——实测 7 次连打，日志里出现了 6 个不同 IP 全放行。
        while _g_hits and now - _g_hits[0] > RATE_WINDOW:
            _g_hits.popleft()
        if len(_g_hits) >= RATE_GLOBAL_MAX:
            return True

        ip = self.client_ip()
        arr = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(arr) >= RATE_MAX:
            _hits[ip] = arr
            return True

        arr.append(now)
        _hits[ip] = arr
        _g_hits.append(now)
        return False

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    # ── 运维接口：自更新 / 代跑脚本 ───────────────────────────────────────
    #
    # 为什么需要这两个：这个容器只有「网页终端」一条交互通道，AI 想改一行脚本得
    # 逐段粘贴 base64，一次十分钟；而部署必读里写的「跑完看 /srv/pub/wb_setup.log」
    # 实际根本没这条通道（脚本只启动不落日志）。所以把两件事做成 HTTP 接口：
    #   /api/pull  用容器自己的 wget 从 GitHub raw 拉最新脚本，只覆盖内容有变化的文件
    #   /api/run   代跑一条**白名单内的**脚本
    # 安全边界：都要口令、都进全局限速；run 只认固定脚本名，不接受任意命令。
    SAFE_SCRIPTS = {
        "nas-setup": ["sh", "nas-setup.sh"],
        "pull": ["sh", "_pull.sh"],
        "index": ["python3", "mkindex.py", str(ROOT)],
        "thumb": ["python3", "mkthumb.py", str(ROOT)],
    }

    def _op(self, kind):
        if self.limited():
            return self._json(429, {"ok": False, "error": "太频繁了，等一下再试"})
        key = self.headers.get("X-Admin-Key", "")
        if not check_key(key):
            log(f"运维接口口令拒绝 ip={self.client_ip()} op={kind}")
            time.sleep(0.4)
            return self._json(401, {"ok": False, "error": "口令不对"})

        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8")) if n else {}
        except Exception:
            return self._json(400, {"ok": False, "error": "body 不是 JSON"})

        if kind == "pull":
            files = body.get("files") or ["nas-setup.sh", "pub_vid.sh", "boot.sh", "album-push.py"]
            r = subprocess.run(["/bin/sh", str(HOME / "_pull.sh")] + files,
                              capture_output=True, text=True, timeout=300, cwd=str(HOME))
            log(f"pull rc={r.returncode}")
            return self._json(200, {"ok": r.returncode == 0, "rc": r.returncode,
                                    "out": (r.stdout + r.stderr)[-4000:]})

        name = body.get("script", "")
        cmd = self.SAFE_SCRIPTS.get(name)
        if not cmd:
            return self._json(400, {"ok": False, "error": f"不在白名单：{name}",
                                    "allowed": sorted(self.SAFE_SCRIPTS)})
        # 不复用 nas-setup 的终端环境；输出直接落 wb_setup.log，浏览器可读
        logf = ROOT / "wb_setup.log"
        with open(logf, "w", encoding="utf-8") as f:
            p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT,
                                 cwd=str(HOME), stdin=subprocess.DEVNULL,
                                 start_new_session=True)
        log(f"run {name} pid={p.pid}")
        return self._json(200, {"ok": True, "pid": p.pid, "script": name,
                                "log": "https://<当前隧道>/wb_setup.log"})

    # ── 进后台的口令校验 ──────────────────────────────────────────────
    # 为什么单独一个接口：进后台和「提交」是两件事。进门校验一次，之后页面拿着
    # 令牌改文案；点「保存并发布」时再问一次口令——两道门都落在 NAS 上，
    # 因为 6 位数字的任何哈希放在前端 JS 里都是公开的，等于没设。
    def _auth(self):
        if auth_braked():
            log(f"口令失败过多，暂停受理 ip={self.client_ip()}")
            return self._json(429, {"ok": False, "error": "试错太多次了，等一分钟再来"})
        if self.limited():
            return self._json(429, {"ok": False, "error": "太频繁了，等一下再试"})

        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 4096:
            return self._json(413, {"ok": False, "error": "体积异常"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._json(400, {"ok": False, "error": "body 不是 JSON"})

        key = str((body or {}).get("key") or "")
        if not check_key(key):
            hit = note_fail()
            log(f"进门口令拒绝 ip={self.client_ip()} 窗口内失败={hit}")
            time.sleep(0.4)                       # 拖慢爆破
            return self._json(401, {"ok": False, "error": "口令不对"})

        tok = issue_token()
        log(f"进门口令通过 ip={self.client_ip()} ttl={TOKEN_TTL}s")
        return self._json(200, {"ok": True, "token": tok, "ttl": TOKEN_TTL})

    def _ok_admin(self) -> bool:
        """令牌优先（进门时校验过），退回一次性口令（老页面 / 运维脚本）。"""
        if check_token(self.headers.get("X-Admin-Auth", "")):
            return True
        return check_key(self.headers.get("X-Admin-Key", ""))

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            self._json(200, {"ok": True, "key_set": bool(load_secret()), "port": PORT,
                             "pbkdf2": load_secret().startswith("pbkdf2$")})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/api/auth":
            return self._auth()
        if p == "/api/pull":
            return self._op("pull")
        if p == "/api/run":
            return self._op("run")
        if p != "/api/save":
            return self._json(404, {"ok": False, "error": "not found"})

        if self.limited():
            return self._json(429, {"ok": False, "error": "太频繁了，等一下再试"})

        if not self._ok_admin():
            note_fail()
            log(f"提交口令/令牌拒绝 ip={self.client_ip()}")
            time.sleep(0.4)                       # 拖慢爆破
            return self._json(401, {"ok": False, "error": "口令不对"})

        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._json(413, {"ok": False, "error": f"体积异常（{n} 字节）"})
        raw = self.rfile.read(n)

        try:
            doc = json.loads(raw.decode("utf-8"))
        except Exception as e:
            return self._json(400, {"ok": False, "error": f"不是合法 JSON: {e}"})

        if not isinstance(doc, dict):
            return self._json(400, {"ok": False, "error": "顶层必须是对象"})
        extra = set(doc) - TOP_KEYS
        if extra:
            return self._json(400, {"ok": False, "error": f"出现未知字段：{sorted(extra)}"})

        err = check_photos(doc)
        if err:
            log(f"校验拒绝：{err}")
            return self._json(422, {"ok": False, "error": err})

        try:
            sha = remote_sha()
        except Exception as e:
            log(f"读远端 sha 失败: {e}")
            return self._json(502, {"ok": False, "error": "读不到 GitHub 上的当前版本"})

        # 存档旧版（尽力而为，失败不阻断）
        saved = ""
        try:
            s, j = gh(f"/contents/{FILE_PATH}?ref={BRANCH}")
            saved = archive(base64.b64decode(j["content"]))
        except Exception as e:
            log(f"取旧版失败: {type(e).__name__}")

        msg = time.strftime("admin: 更新 content.json（%Y-%m-%d %H:%M）")
        body = {
            "message": msg,
            "content": base64.b64encode(raw).decode(),
            "branch": BRANCH,
        }
        if sha:
            body["sha"] = sha
        try:
            s, r = gh(f"/contents/{FILE_PATH}", "PUT", body, timeout=120)
            commit = (r.get("commit") or {}).get("sha", "")
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read().decode()).get("message", "")
            except Exception:
                pass
            code = 409 if e.code == 409 else 502
            log(f"提交失败 HTTP {e.code} {detail}")
            if e.code == 409:
                return self._json(409, {"ok": False, "error": "远端刚被改过，刷新页面重试"})
            return self._json(code, {"ok": False, "error": f"GitHub 返回 {e.code}：{detail}"})
        except Exception as e:
            log(f"提交异常: {type(e).__name__}: {e}")
            return self._json(502, {"ok": False, "error": "连不上 GitHub"})

        log(f"提交成功 commit={commit[:7]} photos={len(doc.get('photos') or [])} archive={saved}")
        return self._json(200, {"ok": True, "commit": commit, "archive": saved})

    def log_message(self, fmt, *args):        # 别把默认访问日志刷进 journal
        pass


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--set-key":
        make_secret(sys.argv[2])
        print(f"口令已写入 {SECRET_F}（pbkdf2，0600）")
        return 0
    if len(sys.argv) >= 2 and sys.argv[1] == "--check":
        raw = load_secret()
        fmt = "pbkdf2" if raw.startswith("pbkdf2$") else ("旧 sha256 格式（建议 --set-key 升级）" if raw else "未设置")
        print("secret:", fmt, "| token:", "有" if TOKEN_F.exists() else "缺")
        return 0

    if not load_secret():
        print("⚠ 还没设口令，先跑：python3 album-push.py --set-key '<口令>'", file=sys.stderr)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"listening 127.0.0.1:{PORT} root={ROOT} origin={ORIGIN}")
    srv.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
