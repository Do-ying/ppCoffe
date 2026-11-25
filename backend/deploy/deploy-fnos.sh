#!/usr/bin/env bash
# ppCoffe → fnOS NAS 一键部署脚本（无 Docker 版）
#
#   bash deploy/deploy-fnos.sh fnos [NAS_IP]
#
# 做什么：
#   1. 同步后端代码到 NAS ~/ppcoffe
#   2. 建 venv、装依赖（阿里云 PyPI 镜像）
#   3. 上传并执行远端准备脚本（MinIO / MySQL / 配置 / systemd 单元）
#   4. 构建 H5 产物（本地构建），注入 NAS 地址后上传
#   5. 重启服务并等待就绪
#
# 依赖：本机已配置该别名的 SSH（~/.ssh/config）。
# 说明：全程不需要 Docker —— NAS 侧用原生进程 + systemd user 单元托管。
set -euo pipefail

HOST="${1:-fnos}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/home/xpw/ppcoffe}"

# 凭据来源：优先环境变量，其次同目录 .env（后者不入库）
# shellcheck disable=SC1091
if [[ -f "$BACKEND_DIR/deploy/.env" ]]; then
    set -a
    . "$BACKEND_DIR/deploy/.env"
    set +a
fi
API_PORT="${API_PORT:-8080}"
H5_PORT="${H5_PORT:-8081}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-19001}"
# NAS 在局域网内的地址：前端产物里的 API 地址必须用它
NAS_IP="${NAS_IP:-192.168.31.13}"

# ---- 复用 fnOS 上已有的 MySQL 容器（宿主机映射端口，非容器内 3306）----
# ⚠️ 密钥不写死在这里 —— 从环境变量或同目录 .env 读取，
#    避免把生产凭据带进版本库。首次部署请先执行：
#      cp fnos.env.example .env && vi .env
MYSQL_PORT="${MYSQL_PORT:-3360}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
MYSQL_APP_USER="${MYSQL_APP_USER:-ppcoffe}"
MYSQL_APP_PASSWORD="${MYSQL_APP_PASSWORD:-}"

# ---- MinIO 凭据 ----
MINIO_ROOT_USER="${MINIO_ROOT_USER:-ppcoffe-root}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
MINIO_APP_ACCESS_KEY="${MINIO_APP_ACCESS_KEY:-ppcoffe}"
MINIO_APP_SECRET_KEY="${MINIO_APP_SECRET_KEY:-}"

# ---- 应用密钥 ----
SECRET_KEY="${SECRET_KEY:-}"
JWT_SECRET="${JWT_SECRET:-}"

# ---- Alpine 源（MinIO 官方二进制已归档下线，用 Alpine 社区包）----
ALPINE_MIRROR="${ALPINE_MIRROR:-https://mirrors.aliyun.com/alpine}"
MINIO_VERSION="${MINIO_VERSION:-0.20250524.170830-r5}"
MC_VERSION="${MC_VERSION:-0.20250521.015954-r5}"

if [[ -z "$HOST" ]]; then
    echo "用法: $0 <ssh-host-alias> [NAS_IP]"
    exit 1
fi

echo "==> [1/5] 同步后端代码到 ${HOST}:${REMOTE_DIR}"
# macOS tar 会写入 AppleDouble 资源叉，用 COPYFILE_DISABLE 关掉
COPYFILE_DISABLE=1 tar \
    --exclude='.venv' --exclude='var' --exclude='__pycache__' \
    --exclude='.pytest_cache' --exclude='.env' --exclude='openapi.json' \
    --exclude='minio-bin' --exclude='._*' \
    -czf - -C "$BACKEND_DIR" . \
    | ssh "$HOST" "mkdir -p '$REMOTE_DIR' && tar -xzf - -C '$REMOTE_DIR' 2>/dev/null; true"

echo "==> [2/5] 安装依赖（venv + 阿里云 PyPI 镜像）"
ssh "$HOST" "cd '$REMOTE_DIR' && \
    { [ -x .venv/bin/python ] || python3.12 -m venv .venv; } && \
    .venv/bin/pip install -q -i https://mirrors.aliyun.com/pypi/simple/ \
        --timeout 120 --retries 5 -r requirements.txt"

echo "==> [3/5] 远端准备（MinIO / MySQL / 配置 / systemd）"
# 远端逻辑放在 fnos-remote-setup.sh 里，避免 ssh 内嵌多层引号把 if/fi 拆坏
scp -q "$BACKEND_DIR/deploy/fnos-remote-setup.sh" "$HOST:$REMOTE_DIR/fnos-remote-setup.sh"
ssh "$HOST" "cd '$REMOTE_DIR' && chmod +x fnos-remote-setup.sh && \
    REMOTE_DIR='$REMOTE_DIR' \
    API_PORT='$API_PORT' \
    H5_PORT='$H5_PORT' \
    MINIO_PORT='$MINIO_PORT' \
    MINIO_CONSOLE_PORT='$MINIO_CONSOLE_PORT' \
    NAS_IP='$NAS_IP' \
    MYSQL_PORT='$MYSQL_PORT' \
    MYSQL_ROOT_USER='$MYSQL_ROOT_USER' \
    MYSQL_ROOT_PASSWORD='$MYSQL_ROOT_PASSWORD' \
    MYSQL_APP_USER='$MYSQL_APP_USER' \
    MYSQL_APP_PASSWORD='$MYSQL_APP_PASSWORD' \
    MINIO_ROOT_USER='$MINIO_ROOT_USER' \
    MINIO_ROOT_PASSWORD='$MINIO_ROOT_PASSWORD' \
    MINIO_APP_ACCESS_KEY='$MINIO_APP_ACCESS_KEY' \
    MINIO_APP_SECRET_KEY='$MINIO_APP_SECRET_KEY' \
    ALPINE_MIRROR='$ALPINE_MIRROR' \
    MINIO_VERSION='$MINIO_VERSION' \
    MC_VERSION='$MC_VERSION' \
    sh ./fnos-remote-setup.sh"

echo "==> [4/5] 构建 H5 并上传"
# Taro 的 outputRoot 是相对项目根的，这里用临时目录避免污染仓库
H5_OUT="$PROJECT_DIR/tmp/dist-fnos"
mkdir -p "$PROJECT_DIR/tmp"
( cd "$PROJECT_DIR" && TARO_APP_OUTPUT_ROOT="$H5_OUT" \
    TARO_APP_API_BASE_URL="http://${NAS_IP}:${API_PORT}/api/v1" \
    npx taro build --type h5 >/dev/null )
tar -czf - -C "$H5_OUT" . | ssh "$HOST" "mkdir -p '$REMOTE_DIR/web' && tar -xzf - -C '$REMOTE_DIR/web' 2>/dev/null; true"
ssh "$HOST" "export XDG_RUNTIME_DIR=/run/user/1000 && systemctl --user restart ppcoffe-h5.service"

echo "==> [5/5] 等待服务就绪"
for i in $(seq 1 20); do
    status=$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${API_PORT}/api/v1/health" 2>/dev/null || echo "")
    if [[ "$status" == "200" ]]; then
        echo "    API 已就绪"
        break
    fi
    [[ $i -eq 20 ]] && { echo "❌ 等待超时"; ssh "$HOST" "export XDG_RUNTIME_DIR=/run/user/1000; journalctl --user -u ppcoffe-api -n 30"; exit 1; }
    sleep 3
done

echo ""
echo "✅ 部署完成（NAS 内网地址 ${NAS_IP}）"
echo ""
echo "   ┌─ H5 前端       http://${NAS_IP}:${H5_PORT}/"
echo "   ├─ API          http://${NAS_IP}:${API_PORT}/api/v1"
echo "   ├─ MinIO S3     http://${NAS_IP}:${MINIO_PORT}        (预签名直传入口)"
echo "   └─ MinIO 控制台  http://${NAS_IP}:${MINIO_CONSOLE_PORT}/"
echo ""
echo "   frp 代理（把内网 ${NAS_IP} 映射到你的公网地址）："
echo "     tcp -> ${NAS_IP}:${H5_PORT}      # 前端"
echo "     tcp -> ${NAS_IP}:${API_PORT}     # API"
echo "     tcp -> ${NAS_IP}:${MINIO_PORT}   # MinIO S3"
echo ""
echo "   ⚠️ SigV4 把 Host 计入签名：走 frp 后预签名端点与前端 API 地址"
echo "      必须改成对外地址，否则直传报 SignatureDoesNotMatch。"
echo "      改法：NAS_IP=<对外地址> bash deploy/deploy-fnos.sh $HOST <对外地址>"
echo ""
echo "   常用运维："
echo "     ssh $HOST 'export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user status ppcoffe-api ppcoffe-minio ppcoffe-h5'"
echo "     ssh $HOST 'export XDG_RUNTIME_DIR=/run/user/1000; journalctl --user -u ppcoffe-minio -f'"
