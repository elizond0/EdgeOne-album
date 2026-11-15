#!/bin/sh
# pub_gh.sh —— 兼容入口，实际逻辑已并入 base-sync.sh
#
# 历史：这个脚本原来只做「把给定域名 PUT 到 GitHub」，没有可达性校验、没有内容比对、
# 没有推送后回读，隧道还没就绪就推会把站点指向打不开的地址。现在统一走 base-sync.sh。
#
# 用法（保持兼容）：
#   sh pub_gh.sh "https://xxxx.trycloudflare.com"
exec sh "$(dirname "$0")/base-sync.sh" --url "$1" --force
