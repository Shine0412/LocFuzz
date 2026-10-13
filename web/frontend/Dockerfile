# 前端镜像：nginx 托管静态单页。构建上下文为 code/ 目录：
#   docker build -f web/frontend/Dockerfile -t locfuzz-frontend .
# 运行时 BACKEND_URL 环境变量注入后端地址（替换 config.js 占位符）。
FROM nginx:alpine

COPY web/frontend/ /usr/share/nginx/html/
COPY web/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
