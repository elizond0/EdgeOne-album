#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""totp_auth —— 全家自建工具共用的动态码（TOTP）验证模块
================================================

是什么
    RFC 6238 动态码（手机验证器 App 上那 6 位数字）的生成与校验，
    纯 Python 标准库实现，无第三方依赖。所有自建拓展工具共用这一份实现
    和同一个密钥（一把钥匙开自家的门），手机验证器里只需绑一条记录。

给工具作者的接入方法（3 行）
    import sys; sys.path.insert(0, "/var/lib/tailscale")   # totp_auth.py 所在目录
    import totp_auth
    if not totp_auth.check_totp(code) and not totp_auth.check_recovery(code):
        return 401            # 码不对；check_totp 在「没开动态码」时返回 True，未开启的部署零负担

密钥与恢复码放在哪
    密钥文件     $TOTP_HOME/totp-secret    （base32，0600）
    恢复码文件   $TOTP_HOME/totp-recovery  （每行一个 XXXX-XXXX，用过即划掉，0600）
    TOTP_HOME 默认 /var/lib/tailscale（album-node 容器内），可设环境变量指向其他目录。

命令行
    python3 totp_auth.py --set          生成新密钥 + 8 个恢复码（打印二维码/密钥/恢复码）
    python3 totp_auth.py --show         打印当前 6 位码与剩余秒数（终端里核对用）
    python3 totp_auth.py --verify CODE  校验一个码，OK / NO
    python3 totp_auth.py --off          关闭动态码（删除密钥与恢复码文件）
    python3 totp_auth.py --check        状态一览：开关、恢复码余量
    python3 totp_auth.py --selftest     跑 RFC 6238 官方向量 + 恢复码一次性自测

安全边界
    · 共用密钥意味着：任何接入工具的代码被攻破 → 所有接入工具的第二道锁同时失效。
      工具暴露面变大后应拆分密钥（设 TOTP_HOME 即可隔离）。
    · 同一枚 6 位码在 30 秒窗口内对所有接入工具都有效，这是设计使然。
    · 恢复码等价于「口令 + 手机」的总和，只存云盘根目录《凭据.md》§1.2，别放任何仓库。
"""

import base64
import hashlib
import hmac
import os
import secrets as _secrets
import time
from pathlib import Path

STEP = 30        # 秒/步，RFC 6238 推荐
DIGITS = 6       # 码长
SKEW = 1         # 允许前后各 1 步（±30 秒），容忍手机与 NAS 的时钟偏差

ISSUER = "homelab"


def home() -> Path:
    """密钥与恢复码所在目录，环境变量 TOTP_HOME 可覆盖。"""
    return Path(os.environ.get("TOTP_HOME", "/var/lib/tailscale"))


def secret_file() -> Path:
    return home() / "totp-secret"


def recovery_file() -> Path:
    return home() / "totp-recovery"


# ---------- 基础计算 ----------

def _b32decode(s: str) -> bytes:
    s = s.strip().upper().replace(" ", "").replace("-", "")
    pad = "=" * (-len(s) % 8)
    return base64.b32decode(s + pad)


def totp_at(secret: str, ts: float | None = None) -> str:
    """算某一时刻的 6 位码。HMAC-SHA1(counter=秒//30) → 动态截断 → 6 位。"""
    counter = int((time.time() if ts is None else ts) // STEP)
    mac = hmac.new(_b32decode(secret), counter.to_bytes(8, "big"), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    code = (int.from_bytes(mac[off:off + 4], "big") & 0x7FFFFFFF) % (10 ** DIGITS)
    return f"{code:0{DIGITS}d}"


# ---------- 状态 ----------

def secret() -> str:
    """读共享密钥；没有就返回 ""。"""
    try:
        return secret_file().read_text(encoding="utf-8").strip().upper()
    except OSError:
        return ""


def enabled() -> bool:
    return bool(secret())


def recovery_left() -> int:
    try:
        return len([x for x in recovery_file().read_text(encoding="utf-8").splitlines() if x.strip()])
    except OSError:
        return 0


def status() -> dict:
    return {"enabled": enabled(), "recovery_left": recovery_left(), "home": str(home())}


# ---------- 校验 ----------

def check_totp(code: str) -> bool:
    """校验动态码，容忍 ±SKEW 步。没开动态码时视为通过（未开启的部署零负担）。"""
    s = secret()
    if not s:
        return True
    code = "".join(ch for ch in str(code) if ch.isdigit())
    if len(code) != DIGITS:
        return False
    now = time.time()
    ok = False
    for k in range(-SKEW, SKEW + 1):
        if hmac.compare_digest(totp_at(s, now + k * STEP), code):
            ok = True                     # 不 break，保持常数时间
    return ok


def check_recovery(code: str) -> bool:
    """恢复码：一次性，命中即从文件里划掉。给「手机丢了」留条路。"""
    code = str(code or "").strip().upper().replace(" ", "")
    if not code:
        return False
    try:
        lines = recovery_file().read_text(encoding="utf-8").splitlines()
    except OSError:
        return False
    hit = False
    out = []
    for ln in lines:
        if not ln.strip():
            continue
        if hmac.compare_digest(ln.strip().upper(), code):
            hit = True                    # 划过，不写回
        else:
            out.append(ln)
    if hit:
        try:
            recovery_file().write_text("\n".join(out) + ("\n" if out else ""), encoding="utf-8")
            os.chmod(recovery_file(), 0o600)
        except OSError:
            pass
    return hit


def verify(code: str) -> bool:
    """工具接入的统一入口：动态码或恢复码任一命中即通过。"""
    return check_totp(code) or check_recovery(code)


# ---------- 开通 / 关闭 ----------

def make_totp() -> tuple[str, list[str], str]:
    """生成新密钥 + 8 个恢复码，落盘 0600。返回 (密钥, 恢复码, otpauth 链接)。"""
    s = base64.b32encode(_secrets.token_bytes(20)).decode("ascii").rstrip("=")
    codes = [f"{_secrets.token_hex(2).upper()}-{_secrets.token_hex(2).upper()}" for _ in range(8)]
    home().mkdir(parents=True, exist_ok=True)
    secret_file().write_text(s + "\n", encoding="utf-8")
    os.chmod(secret_file(), 0o600)
    recovery_file().write_text("\n".join(codes) + "\n", encoding="utf-8")
    os.chmod(recovery_file(), 0o600)
    uri = f"otpauth://totp/{ISSUER}:totp-auth?secret={s}&issuer={ISSUER}&algorithm=SHA1&digits={DIGITS}&period={STEP}"
    return s, codes, uri


def off() -> None:
    for f in (secret_file(), recovery_file()):
        try:
            f.unlink()
        except OSError:
            pass


# ---------- 自测 ----------

def selftest() -> bool:
    """RFC 6238 官方向量 + 恢复码一次性。全过返回 True，失败项打印到 stdout。"""
    ok = True
    # RFC 6238 Appendix B（SHA1，8 字节密钥 "12345678901234567890" 的 base32）
    s = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    for t, want in [(59, "287082"), (1111111109, "081804"), (1111111111, "050471"),
                    (1234567890, "005924"), (2000000000, "279037")]:
        got = totp_at(s, t)
        if got != want:
            print(f"FAIL RFC6238 t={t}: got {got}, want {want}")
            ok = False
    # 容差窗口 + 恢复码一次性（临时目录，不碰真实密钥）
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.environ["TOTP_HOME"] = td
        try:
            s2 = "VHYHK3BSFHCEOWSXL2HNT5S5ZX4SQJVD"
            now = int(time.time())
            (Path(td) / "totp-secret").write_text(s2 + "\n", encoding="utf-8")
            if not check_totp(totp_at(s2, now + STEP)):
                print("FAIL skew: +30s 应通过（SKEW=1）")
                ok = False
            if check_totp(totp_at(s2, now - 3 * STEP)):
                print("FAIL skew: -90s 应拒绝（超出 SKEW=1）")
                ok = False
            _s, codes, _u = make_totp()
            if len(codes) != 8:
                print(f"FAIL recovery: 应生成 8 个，实际 {len(codes)}")
                ok = False
            if not check_recovery(codes[0]):
                print("FAIL recovery: 首个恢复码未命中")
                ok = False
            if check_recovery(codes[0]):
                print("FAIL recovery: 同一恢复码不应命中第二次")
                ok = False
            if recovery_left() != 7:
                print(f"FAIL recovery: 余量应为 7，实际 {recovery_left()}")
                ok = False
        finally:
            del os.environ["TOTP_HOME"]
    return ok


# ---------- CLI ----------

def _print_qr(text: str) -> None:
    try:
        import qrcode
    except ImportError:
        print("（终端没装 qrcode 库，跳过二维码，用下面的手动密钥即可）")
        return
    q = qrcode.QRCode(border=1)
    q.add_data(text)
    q.make(fit=True)
    q.print_ascii(invert=True)


def main() -> int:
    import sys
    argv = sys.argv[1:]
    if "--selftest" in argv:
        return 0 if selftest() else 1
    if "--set" in argv:
        s, codes, uri = make_totp()
        print("动态码已开启。手机验证器 App 扫下面的二维码（或手动输密钥）：\n")
        _print_qr(uri)
        print(f"\n手动输入：{s}")
        print("\n恢复码（手机丢了时用，每个只能用一次；存云盘《凭据.md》§1.2）：")
        for c in codes:
            print("  " + c)
        return 0
    if "--show" in argv:
        s = secret()
        if not s:
            print("动态码未开启。开启：python3 totp_auth.py --set")
            return 0
        print("当前码:", totp_at(s), f"（{STEP - int(time.time()) % STEP} 秒后失效）")
        return 0
    if "--verify" in argv:
        code = argv[argv.index("--verify") + 1] if len(argv) > argv.index("--verify") + 1 else ""
        print("OK" if verify(code) else "NO")
        return 0
    if "--off" in argv:
        off()
        print("动态码已关闭（各工具的口令仍在，各自照旧）")
        return 0
    if "--check" in argv:
        st = status()
        print("totp:  ", "开" if st["enabled"] else "关", "| 恢复码:", st["recovery_left"], "个 | 目录:", st["home"])
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
