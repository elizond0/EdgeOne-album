#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NAS 门户会话自动恢复（跨对话可用版）。

凭据优先级：
  1. 环境变量 WB_CRED_FILE 指定的文件
  2. /dev/shm/wb_credentials.json   ← 由 cred_load.py 从云盘《凭据.md》现场生成，首选
  3. <脚本同目录>/credentials.json  ← 会话内派生副本，兼容旧流程，非权威源

新对话标准流程：
  下载云盘根目录《凭据.md》 → python3 cred_load.py <路径> → python3 nas_session.py
凭据文件位置固定为云盘根目录 `凭据.md`，全项目账号 / 密码 / token 明文只此一份
（《项目通用规则》§7.1.1）；按文件名定位，不要缓存 file_id。
凭据本体永不落持久盘、永不打印、永不回显。
"""
import asyncio
import json
import os
from playwright.async_api import async_playwright

D = os.path.dirname(os.path.abspath(__file__)) + "/"
CANDIDATES = [
    os.environ.get("WB_CRED_FILE", ""),
    "/dev/shm/wb_credentials.json",
    D + "credentials.json",
]
STATE = D + "state.json"


def load_cred():
    for path in CANDIDATES:
        if not path or not os.path.isfile(path):
            continue
        try:
            c = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        nas = c.get("nas", {})
        if nas.get("username") and nas.get("password"):
            return c, path
    print("ERROR 找不到可用凭据。先执行：python3 cred_load.py <云盘下载的凭据.md 路径>")
    raise SystemExit(2)


async def main():
    cred, cred_src = load_cred()
    c = cred["nas"]
    portal = c.get("portal") or "https://ug.link/ugreen4600"

    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx_args = dict(viewport={"width": 1600, "height": 1000}, locale="zh-CN")
        # 新对话可能没有上次留下的 state.json，缺文件就以全新会话启动并自动登录
        if os.path.isfile(STATE):
            ctx_args["storage_state"] = STATE
        ctx = await b.new_context(**ctx_args)
        pg = await ctx.new_page()
        await pg.goto(portal, wait_until="domcontentloaded", timeout=45000)
        await pg.wait_for_timeout(8000)

        relog = False
        if await pg.locator("input[type='password']").count() > 0:
            relog = True
            await pg.fill("input[type='text']", c["username"], timeout=8000)
            await pg.fill("input[type='password']", c["password"], timeout=8000)
            try:
                cb = pg.locator(".arco-checkbox").first
                if await cb.count() > 0:
                    await cb.click(timeout=3000)
            except Exception:
                pass
            await pg.click("button:has-text('登录')", timeout=8000)
            await pg.wait_for_timeout(12000)

        role = await pg.evaluate(
            "()=>{try{return JSON.parse(localStorage.proUserInfo||'{}').role}catch(e){return 'err'}}"
        )
        await ctx.storage_state(path=STATE)
        print("cred_src=%s relogin=%s role=%s url=%s state_saved=OK"
              % ("memory" if "/dev/shm" in cred_src else os.path.basename(cred_src),
                 relog, role, pg.url))
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
