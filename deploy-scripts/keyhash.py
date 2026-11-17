#!/usr/bin/env python3
"""口令哈希计算（PBKDF2-HMAC-SHA256）。

NAS 侧 album-push.py 用同一套算法校验，两边必须完全一致，否则口令永远对不上。

存储格式（单行，写在 push-secret，chmod 600）：
    pbkdf2$<迭代数>$<salt hex 32 位>$<dk hex 64 位>

为什么不用「盐+口令 直接 sha256」那种存法：
    盐是随机的，校验时拿不到盐就没法重算。所以盐必须跟着哈希一起存下来。
    早期那版把 sha256(salt+pw)[:16] 当 tag 存，校验等于要暴力反推 salt —— 那是个
    死胡同（2026-11-17 顺带修掉的隐患）。现在盐明文存在文件里，文件本身 600，
    且只有 root 能读，安全性由文件权限兜。

迭代 200000 次：入口是 6 位数字口令，熵很低，靠迭代数把手动穷举的成本抬起来。
单次校验在本机的 NAS 上约 60~120ms，登录体感无感。

用法:
    python3 keyhash.py hash  <口令>         # 打印一行存储串
    python3 keyhash.py check <口令> <存储串> # 打印 OK / NO
"""
import hashlib
import hmac
import os
import sys

ITER = 200_000


def make(pw: str, iter_: int = ITER) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iter_, dklen=32)
    return f"pbkdf2${iter_}${salt.hex()}${dk.hex()}"


def check(pw: str, stored: str) -> bool:
    try:
        head, it, salt_hex, dk_hex = stored.strip().split("$")
        if head != "pbkdf2":
            return False
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, int(it), dklen=32)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "hash" and len(sys.argv) > 2:
        sys.stdout.write(make(sys.argv[2]))
    elif cmd == "check" and len(sys.argv) > 3:
        print("OK" if check(sys.argv[2], sys.argv[3]) else "NO")
    else:
        print(__doc__)
