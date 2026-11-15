#!/usr/bin/env bash
# 发布：刷新页脚版本时间戳 → 提交 → 推送。
# 每次上线都跑这一条，页脚时间才等于「这次部署的时间」。
set -euo pipefail

cd "$(dirname "$0")/.."

python3 scripts/gen_pages.py

if git diff --quiet; then
  echo "没有改动，跳过提交"
else
  git add -A
  git commit -m "chore: 发布 $(date '+%Y-%m-%d %H:%M')"
fi

git push origin main
echo
echo "已推送。GitHub Pages 约 1 分钟后生效："
echo "  https://elizond0.github.io/album/"
