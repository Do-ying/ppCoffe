#!/usr/bin/env bash
# 部署 MinIO 到远端 Docker
#
# 前提：本地已交叉编译好 linux/amd64 二进制（见 build-minio-images.sh，或在任意
#       机器上编译后拷到本地）：
#         ~/minio-build/minio-linux-amd64
#         ~/minio-build/mc-linux-amd64
#
# 远端只做「轻量」的 docker build（仅 COPY 文件，不编译），
# 避免在小内存机器上跑 Go 编译把整机拖垮。
#
#   ./deploy-minio.sh aliyun
set -euo pipefail

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
    echo "用法: $0 <ssh-host-alias>"
    exit 1
fi

BUILD_DIR="${BUILD_DIR:-$HOME/minio-build}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ppcoffe}"
MINIO_VERSION="${MINIO_VERSION:-RELEASE.2025-04-22T22-12-26Z}"
MC_VERSION="${MC_VERSION:-RELEASE.2025-04-16T18-13-26Z}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in "$BUILD_DIR/minio-linux-amd64" "$BUILD_DIR/mc-linux-amd64"; do
    [[ -f "$f" ]] || { echo "缺少 $f，请先编译"; exit 1; }
    # 必须是 ELF 可执行文件（防止误传 go build 产出的 .a 归档）
    head -c 4 "$f" | grep -q $'\x7fELF' || { echo "$f 不是 ELF 可执行文件"; exit 1; }
done

echo "==> 上传二进制与构建上下文"
COPYFILE_DISABLE=1 tar \
    --exclude='._*' \
    -czf - -C "$SCRIPT_DIR" Dockerfile.minio Dockerfile.mc \
    | ssh "$HOST" "mkdir -p '$REMOTE_DIR/deploy/minio-build' && tar -xzf - -C '$REMOTE_DIR/deploy/minio-build'"

COPYFILE_DISABLE=1 tar --exclude='._*' -czf - \
    -C "$BUILD_DIR" minio-linux-amd64 mc-linux-amd64 \
    | ssh "$HOST" "tar -xzf - -C '$REMOTE_DIR/deploy/minio-build'"

# 官方 entrypoint 脚本（若本地有）
if [[ -f "$BUILD_DIR/docker-entrypoint.sh" ]]; then
    COPYFILE_DISABLE=1 tar --exclude='._*' -czf - -C "$BUILD_DIR" docker-entrypoint.sh \
        | ssh "$HOST" "tar -xzf - -C '$REMOTE_DIR/deploy/minio-build'"
fi

echo "==> 远端构建镜像"
ssh "$HOST" "cd '$REMOTE_DIR/deploy/minio-build' && \
    mkdir -p ctx/minio ctx/mc && \
    cp minio-linux-amd64 ctx/minio/minio && \
    cp mc-linux-amd64 ctx/mc/mc && \
    cp mc-linux-amd64 ctx/minio/mc && \
    cp /etc/ssl/certs/ca-certificates.crt ctx/minio/ca-certificates.crt && \
    cp /etc/ssl/certs/ca-certificates.crt ctx/mc/ca-certificates.crt && \
    { [ -f docker-entrypoint.sh ] && cp docker-entrypoint.sh ctx/minio/ ; true; } && \
    docker build -q -t 'minio/minio:$MINIO_VERSION' -f Dockerfile.minio ctx/minio && \
    docker build -q -t 'minio/mc:$MC_VERSION' -f Dockerfile.mc ctx/mc"

echo "==> 启用 MinIO 服务"
ssh "$HOST" "cd '$REMOTE_DIR' && \
    sed -i 's|^STORAGE_DRIVER=.*|STORAGE_DRIVER=minio|' .env && \
    docker compose --profile minio up -d"

echo "==> 等待 MinIO 就绪"
for i in $(seq 1 30); do
    status=$(ssh "$HOST" "docker inspect -f '{{.State.Status}}' ppcoffe-minio 2>/dev/null || echo down")
    if [[ "$status" == "running" ]]; then
        echo "    MinIO 容器已运行"
        break
    fi
    [[ $i -eq 30 ]] && { echo "❌ MinIO 未起来，请检查 docker compose logs minio"; exit 1; }
    sleep 3
done

echo "==> 检查桶与账号初始化结果"
ssh "$HOST" "docker logs ppcoffe-minio-init 2>&1 | tail -20"

echo "==> 健康检查"
ssh "$HOST" "curl -s -m 10 http://127.0.0.1/api/v1/health"

echo ""
echo "✅ MinIO 部署完成"
