#!/usr/bin/env bash
# ppCoffe 后端一键部署 / 更新
#
#   ./deploy/deploy.sh aliyun          # 同步代码 + 重建镜像 + 重启服务
#   ./deploy/deploy.sh aliyun --seed   # 同步后额外灌入演示数据
#   ./deploy/deploy.sh aliyun --minio  # 同步后一并部署 MinIO（含建桶与受限账号）
#
# 依赖：本机已配置该别名的 SSH（~/.ssh/config），远端已装好 Docker。
set -euo pipefail

HOST="${1:-}"
SEED=0
WITH_MINIO=0
for arg in "${@:2}"; do
    case "$arg" in
        --seed) SEED=1 ;;
        --minio) WITH_MINIO=1 ;;
        *) echo "未知参数: $arg"; exit 1 ;;
    esac
done

if [[ -z "$HOST" ]]; then
    echo "用法: $0 <ssh-host-alias> [--seed] [--minio]"
    exit 1
fi

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/opt/ppcoffe}"

echo "==> 同步代码到 ${HOST}:${REMOTE_DIR}"
# macOS tar 会写入 AppleDouble 资源叉，用 COPYFILE_DISABLE 关掉
COPYFILE_DISABLE=1 tar \
    --exclude='.venv' --exclude='var' --exclude='__pycache__' \
    --exclude='.pytest_cache' --exclude='.env' --exclude='openapi.json' \
    --exclude='._*' \
    -czf - -C "$BACKEND_DIR" . \
    | ssh "$HOST" "tar -xzf - -C '$REMOTE_DIR' && find '$REMOTE_DIR' -name '._*' -delete"

if [[ $WITH_MINIO -eq 1 ]]; then
    echo "==> 构建并启动 MinIO（自建镜像：Alpine 源安装，绕开 Docker Hub 第三方命名空间封锁）"
    ssh "$HOST" "cd '$REMOTE_DIR' && docker compose --profile minio build minio && \
                docker compose --profile minio up -d minio"

    echo "==> 等待 MinIO 就绪"
    for i in $(seq 1 30); do
        status=$(ssh "$HOST" "cd '$REMOTE_DIR' && docker compose ps minio --format '{{.Status}}'" 2>/dev/null || echo "")
        if [[ "$status" == *"healthy"* ]]; then
            echo "    MinIO 已健康"
            break
        fi
        [[ $i -eq 30 ]] && { echo "❌ 等待超时：docker compose logs minio"; exit 1; }
        sleep 3
    done

    echo "==> 初始化桶与受限账号"
    ssh "$HOST" "cd '$REMOTE_DIR' && docker compose --profile minio run --rm minio-init"
fi

echo "==> 重建 API 镜像并重启"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build api && docker compose up -d nginx"

echo "==> 等待服务就绪"
for i in $(seq 1 30); do
    status=$(ssh "$HOST" "cd '$REMOTE_DIR' && docker compose ps api --format '{{.Status}}'" 2>/dev/null || echo "")
    if [[ "$status" == *"healthy"* ]]; then
        echo "    API 已健康"
        break
    fi
    [[ $i -eq 30 ]] && { echo "❌ 等待超时，请检查 docker compose logs api"; exit 1; }
    sleep 3
done

if [[ $SEED -eq 1 ]]; then
    echo "==> 灌入演示数据"
    ssh "$HOST" "cd '$REMOTE_DIR' && docker compose exec -T api python manage.py seed"
fi

echo "==> 健康检查"
ssh "$HOST" "curl -s -m 10 http://127.0.0.1/api/v1/health"

echo ""
echo "✅ 部署完成"
