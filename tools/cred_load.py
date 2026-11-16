#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从云盘根目录《凭据.md》解析登录凭据 → 写入内存盘 /dev/shm，供 nas_session.py 等工具使用。

《凭据.md》是**全项目唯一密钥文件、路径固定**（《项目通用规则》§7.1.1）：
§1 NAS 门户、§2 青龙面板、§3 GitHub PAT 都在这里，本脚本一次解析完，
内存态 JSON 里同时给出 nas / qinglong / github 三段，其它工具不必再单独下载文件。

新对话标准流程（凭据只有一个家，其余全是内存态派生）：
  1. 用网盘工具下载云盘资产根目录的 `凭据.md` 到任意临时路径
  2. python3 cred_load.py <下载下来的凭据.md 路径>
  3. python3 nas_session.py          # 自动优先读 /dev/shm
  4. 用完 rm -f /dev/shm/wb_credentials.json

安全约束：本脚本**不打印任何凭证明文**，只打印来源、落点与长度统计；
         不写入 /workspace 文档、不上传云盘、不生成第二份持久明文。
"""
import json
import os
import re
import sys

SHM = "/dev/shm/wb_credentials.json"
DEFAULT_NAS_PORTAL = "https://ug.link/ugreen4600"
DEFAULT_QL_API = "http://127.0.0.1:5700"
DEFAULT_QL_LAN = "http://192.168.0.125:5700"
DEFAULT_QL_LOGIN = "/api/user/login"


def rows(section_text):
    """把 Markdown 表格读成 {第一列: 第二列}；值去掉包裹的反引号。"""
    out = {}
    for line in section_text.splitlines():
        line = line.strip()
        if not line.startswith("|") or set(line) <= set("|-: "):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        key, val = cells[0], cells[1]
        if key in ("项", "值") or set(key) <= set("-: "):
            continue
        out[key] = val.strip().strip("`").strip()
    return out


# 注意：门户地址 / API 入口 / 登录接口都是**环境常量**，不从《凭据.md》表格里解析。
# 那些单元格带箭头、括号说明等散文，正则抠出来不可靠；写死在下面反而最稳。


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/凭据.md"
    if not os.path.isfile(src):
        print("ERROR 找不到凭据文件：%s" % src)
        print("       先用网盘工具下载云盘根目录《凭据.md》再传其路径")
        return 2
    text = open(src, encoding="utf-8").read()

    sections = {}
    for part in re.split(r"(?m)^##\s+", text)[1:]:
        lines = part.splitlines()
        if lines:
            sections[lines[0].strip()] = part

    nas_sec = next((v for k, v in sections.items() if k.startswith("1.")), None)
    ql_sec = next((v for k, v in sections.items() if k.startswith("2.")), None)
    gh_sec = next((v for k, v in sections.items() if k.startswith("3.")), None)
    if not nas_sec or not ql_sec:
        print("ERROR 《凭据.md》结构变了，没找到 §1 绿联 NAS 门户 / §2 青龙面板")
        return 3
    nas, ql, gh = rows(nas_sec), rows(ql_sec), (rows(gh_sec) if gh_sec else {})

    # §3 GitHub PAT 是全项目唯一权威明文；只进内存态派生 JSON，不落持久盘、不打印。
    # 缺 §3 时保持空串（向后兼容旧版《凭据.md》），不阻断 NAS 登录链路。
    github_token = gh.get("PAT 明文", "").strip().strip("`").strip()

    cred = {
        "github": {
            "username": gh.get("账号", "").strip().strip("`").strip(),
            "token": github_token,
        },
        "nas": {
            "username": nas.get("账号", ""),
            "password": nas.get("密码", ""),
            "portal": DEFAULT_NAS_PORTAL,
            "role": "admin",
        },
        "qinglong": {
            "username": ql.get("账号", ""),
            "password": ql.get("密码", ""),
            "api_container": DEFAULT_QL_API,
            "api_lan": DEFAULT_QL_LAN,
            "login_endpoint": DEFAULT_QL_LOGIN,
        },
    }

    n, q = cred["nas"], cred["qinglong"]
    if not all([n["username"], n["password"], q["username"], q["password"]]):
        print("ERROR 账号或密码解析为空，未写入内存盘（请检查《凭据.md》表格）")
        return 4

    with open(SHM, "w", encoding="utf-8") as f:
        json.dump(cred, f, ensure_ascii=False, indent=2)
    os.chmod(SHM, 0o600)

    # 只输出非敏感元信息
    print("OK  source=%s" % os.path.basename(src))
    print("    target=%s mode=0600 (内存盘，重启即消失)" % SHM)
    print("    nas.user_len=%d ql.user_len=%d portal=%s ql_api=%s"
          % (len(n["username"]), len(q["username"]), n["portal"], q["api_container"]))
    print("    github.token_len=%d (仅长度，明文未回显)" % len(github_token))
    print("    凭证明文未回显、未落持久盘、未上传云盘")
    return 0


if __name__ == "__main__":
    sys.exit(main())
