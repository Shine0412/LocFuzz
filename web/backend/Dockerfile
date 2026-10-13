# 后端镜像：node:20-slim 基础（内置 Node 跑 coverage_agent.js），
# 再装 Python 跑 FastAPI。构建上下文为 code/ 目录：
#   docker build -f web/backend/Dockerfile -t locfuzz-backend .
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用构建缓存）
COPY web/backend/requirements.txt /app/web/backend/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages \
        -r /app/web/backend/requirements.txt

# 拷入全部代码（含 locfuzz 包、.secret 密钥、seeds；不含 results 等产物）
COPY . /app

ENV BACKEND_PORT=6024 \
    LOC_FUZZ_DATA_DIR=/data \
    CORS_ORIGINS=*

EXPOSE 6024
CMD ["sh", "-c", "uvicorn web.backend.main:app --host 0.0.0.0 --port ${BACKEND_PORT:-6024}"]
