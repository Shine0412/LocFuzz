#!/bin/sh
# 用 BACKEND_URL 环境变量替换 config.js 中的占位符后启动 nginx
BACKEND_URL="${BACKEND_URL:-http://localhost:6024}"
sed -i "s|__BACKEND_URL__|${BACKEND_URL}|g" /usr/share/nginx/html/config.js
echo "[frontend] backend url: ${BACKEND_URL}"
exec nginx -g 'daemon off;'
