#!/usr/bin/env bash
# ppCoffe → fnOS NAS 部署脚本（Docker 版）
#
#   bash deploy/deploy-fnos-docker.sh fnos
#
# 对外地址（可选，决定前端产物里的 API 地址与 MinIO 预签名端点）：
#
#   A) 分域名 + HTTPS（frp vhostHTTPSPort 模式）：
#      WEB_DOMAIN=ppweb.lovexpw.cn \
#      API_DOMAIN=ppapi.lovexpw.cn \
#      MINIO_DOMAIN=ppminio.lovexpw.cn \
#      PUBLIC_SCHEME=https \
#      bash deploy/deploy-fnos-docker.sh fnos
#
#   B) 单地址 + 端口（frp TCP 模式）：
#      PUBLIC_HOST=1.2.3.4 PUBLIC_SCHEME=http \
#      bash deploy/deploy-fnos-docker.sh fnos
#
# 不给对外地址时默认用 NAS 内网地址（192.168.31.13），仅供局域网调试。
#
# 做什么：
#   1. 同步项目到 NAS /vol2/1000/public/ppcoffe
#   2. 本地构建 H5 产物（注入对外 API 地址），组装 web/ 构建上下文
#   3. 传输镜像（本地有 docker 时 docker save；否则从阿里云中转机拉取）
#   4. 生成 .env，启动 compose 全栈
#   5. 等待服务就绪
#
# 依赖：本机已配置该别名的 SSH（~/.ssh/config）。
# 说明：NAS 侧全程 Docker Compose，前端/后端/存储/数据库全部容器化。
set -euo pipefail

HOST="${1:-fnos}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/vol2/1000/public/ppcoffe}"

# 凭据来源：优先环境变量，其次同目录 .env（后者不入库）
# shellcheck disable=SC1091
if [[ -f "$BACKEND_DIR/deploy/.env" ]]; then
    set -a
    . "$BACKEND_DIR/deploy/.env"
    set +a
fi

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-8081}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-19001}"
# NAS 在局域网内的地址：容器间访问用它
NAS_IP="${NAS_IP:-192.168.31.13}"

# ---- 对外访问地址（浏览器实际访问的地址）----
#
# 两种模式：
#
#  A) 分域名 + HTTPS（frp vhostHTTPSPort 模式，推荐）：
#       导出 WEB_DOMAIN / API_DOMAIN / MINIO_DOMAIN 即可。
#       三个域名各自独立，MinIO 的预签名 Host 与浏览器一致，SigV4 不会错。
#
#  B) 单地址 + 端口（frp TCP 模式）：
#       不设域名，PUBLIC_HOST 指向 NAS 或公网 IP，端口用各自的。
#
# ⚠️ SigV4 把 Host（含端口）算进签名，所以 MINIO 公共端点必须与
#    浏览器实际访问的 host:port 完全一致，否则直传报 403。
PUBLIC_HOST="${PUBLIC_HOST:-${NAS_IP}}"
PUBLIC_SCHEME="${PUBLIC_SCHEME:-http}"
WEB_DOMAIN="${WEB_DOMAIN:-}"
API_DOMAIN="${API_DOMAIN:-}"
MINIO_DOMAIN="${MINIO_DOMAIN:-}"

# ---- 复用 fnOS 上已有的 MySQL 容器（宿主机映射端口，不是容器内 3306）----
# ⚠️ 密钥不写死在这里 —— 从环境变量或同目录 .env 读取，
#    避免把生产凭据带进版本库。首次部署请先执行：
#      cp fnos.env.example .env && vi .env
MYSQL_PORT="${MYSQL_PORT:-3360}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
MYSQL_APP_USER="${MYSQL_APP_USER:-ppcoffe}"
MYSQL_APP_PASSWORD="${MYSQL_APP_PASSWORD:-}"
# 容器内访问宿主机上那个 MySQL 的地址。
# host.docker.internal 在 Linux 上默认不解析，这里用 docker0 网关（已实测可达 :3360）。
DOCKER_HOST_GW="${DOCKER_HOST_GW:-172.17.0.1}"

# ---- MinIO 凭据 ----
MINIO_ROOT_USER="${MINIO_ROOT_USER:-ppcoffe-root}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
MINIO_APP_ACCESS_KEY="${MINIO_APP_ACCESS_KEY:-ppcoffe}"
MINIO_APP_SECRET_KEY="${MINIO_APP_SECRET_KEY:-}"

# ---- 应用密钥 ----
SECRET_KEY="${SECRET_KEY:-}"
JWT_SECRET="${JWT_SECRET:-}"

# 缺凭据就直接报错，避免带着空密码去连库
for required in MYSQL_ROOT_PASSWORD MYSQL_APP_PASSWORD MINIO_ROOT_PASSWORD \
                MINIO_APP_SECRET_KEY SECRET_KEY JWT_SECRET; do
    if [[ -z "${!required}" ]]; then
        echo "❌ 缺少 $required —— 请先在 backend/deploy/.env 里配置，或用环境变量传入" >&2
        echo "   cp backend/deploy/fnos.env.example backend/deploy/.env && vi backend/deploy/.env" >&2
        exit 1
    fi
done

# ---- 计算对外访问地址 ----
# 分域名模式：https://<domain>（HTTPS 默认 443，不带端口）
# 单地址模式：<scheme>://<host>:<port>
if [[ -n "$WEB_DOMAIN" ]]; then
    WEB_URL="${PUBLIC_SCHEME}://${WEB_DOMAIN}"
else
    WEB_URL="${PUBLIC_SCHEME}://${PUBLIC_HOST}:${WEB_PORT}"
fi
if [[ -n "$API_DOMAIN" ]]; then
    API_URL="${PUBLIC_SCHEME}://${API_DOMAIN}"
else
    API_URL="${PUBLIC_SCHEME}://${PUBLIC_HOST}:${API_PORT}"
fi
if [[ -n "$MINIO_DOMAIN" ]]; then
    # HTTPS 默认 443 —— SigV4 签名端点不能带多余的端口
    MINIO_URL="${PUBLIC_SCHEME}://${MINIO_DOMAIN}"
    MINIO_PUBLIC_ENDPOINT_VALUE="${MINIO_DOMAIN}"
else
    MINIO_URL="${PUBLIC_SCHEME}://${PUBLIC_HOST}:${MINIO_PORT}"
    MINIO_PUBLIC_ENDPOINT_VALUE="${PUBLIC_HOST}:${MINIO_PORT}"
fi

# ---- 镜像来源：优先用本地 docker save，否则从阿里云中转机取预打包的镜像 ----
IMAGE_SOURCE="${IMAGE_SOURCE:-auto}"   # auto | local | aliyun
ALIYUN_HOST="${ALIYUN_HOST:-aliyun}"
# 阿里云中转机上的合并镜像包（含 base + 自建镜像）
ALIYUN_IMAGE_TAR="${ALIYUN_IMAGE_TAR:-/tmp/ppcoffe-all.tar.gz}"
LOCAL_IMAGE_TAR="${LOCAL_IMAGE_TAR:-/tmp/ppcoffe-all.tar.gz}"

if [[ -z "$HOST" ]]; then
    echo "用法: $0 <ssh-host-alias> [NAS_IP]"
    exit 1
fi

say() { printf '\n==> %s\n' "$1"; }

# ======================================================================
say "[1/6] 同步项目到 ${HOST}:${REMOTE_DIR}"
# 用 rsync 而非 tar：该项目在飞牛同步盘上，bsdtar 递归打包会跳过 backend/
# （SEEK_HOLE 问题），且部分临时文件读取会超时。
# _mcp_*.py 是探测 fnOS 时留下的未跟踪临时文件，同步盘上读取会超时，必须排除。
rsync -az \
    --exclude='.git/' --exclude='node_modules/' \
    --exclude='dist/' --exclude='dist-h5/' --exclude='dist-h5*/' \
    --exclude='tmp/' --exclude='_mcp_*.py' \
    --exclude='backend/.venv/' --exclude='backend/var/' \
    --exclude='backend/__pycache__/' --exclude='backend/.pytest_cache/' \
    --exclude='backend/.env' --exclude='backend/openapi.json' \
    --exclude='._*' --exclude='.DS_Store' \
    "$PROJECT_DIR/" "$HOST:$REMOTE_DIR/"

# ======================================================================
say "[2/6] 构建 H5 产物并组装 web/ 构建上下文"
# ⚠️ Taro 的 outputRoot 是用 path.join(cwd, outputRoot) 解析的 ——
#    传绝对路径会被重复拼接（/proj + /proj/tmp/... → /proj/proj/tmp/...），
#    所以这里必须用**相对项目根**的相对路径。
H5_OUT_REL="tmp/dist-fnos-docker"
H5_OUT="$PROJECT_DIR/$H5_OUT_REL"
mkdir -p "$PROJECT_DIR/tmp"
( cd "$PROJECT_DIR" && TARO_APP_OUTPUT_ROOT="$H5_OUT_REL" \
    TARO_APP_API_BASE_URL="${API_URL}/api/v1" \
    npx taro build --type h5 >/dev/null )

# 构建结果必须真的落在预期位置，否则后续拷的是空目录
if [[ ! -f "$H5_OUT/index.html" ]]; then
    echo "❌ H5 产物未生成在 $H5_OUT" >&2
    exit 1
fi
echo "    H5 构建完成（${H5_OUT}）"

# web/ 构建上下文 = dist 产物 + nginx 配置 + Dockerfile
rm -rf "$PROJECT_DIR/tmp/webctx"
mkdir -p "$PROJECT_DIR/tmp/webctx"
cp -R "$H5_OUT" "$PROJECT_DIR/tmp/webctx/dist"
cp "$BACKEND_DIR/deploy/nginx-fnos.conf" "$PROJECT_DIR/tmp/webctx/nginx.conf"
cp "$BACKEND_DIR/deploy/web.Dockerfile" "$PROJECT_DIR/tmp/webctx/Dockerfile"

# ======================================================================
say "[3/6] 准备镜像"
# 优先本地 docker save；没有本地 docker 时从阿里云中转机取预打包的镜像。
# 中转机上已合并 base 镜像与自建镜像，一次传输即可。
need_local_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

if [[ "$IMAGE_SOURCE" == "aliyun" ]]; then
    echo "    从阿里云中转机取镜像..."
    scp -q "$ALIYUN_HOST:$ALIYUN_IMAGE_TAR" "$LOCAL_IMAGE_TAR"
elif [[ "$IMAGE_SOURCE" == "local" ]] || need_local_docker; then
    echo "    本地 docker save..."
    docker save nginx:1.27-alpine redis:7-alpine alpine:3.22 python:3.12-slim \
        ppcoffe/minio:alpine-20250524 ppcoffe-api:latest \
        2>/dev/null | gzip -3 > "$LOCAL_IMAGE_TAR"
elif [[ -f "$LOCAL_IMAGE_TAR" ]]; then
    # 复用本地已下载的包（316MB，重新下载要几分钟）
    echo "    复用本地镜像包 $(ls -lh "$LOCAL_IMAGE_TAR" | awk '{print $5}')"
else
    echo "    从阿里云中转机取镜像..."
    scp -q "$ALIYUN_HOST:$ALIYUN_IMAGE_TAR" "$LOCAL_IMAGE_TAR"
fi
ls -lh "$LOCAL_IMAGE_TAR"

# 同时传输 web 构建上下文
tar -czf /tmp/ppcoffe-webctx.tar.gz -C "$PROJECT_DIR/tmp/webctx" .
scp -q /tmp/ppcoffe-webctx.tar.gz "$HOST:/tmp/ppcoffe-webctx.tar.gz"

# ======================================================================
say "[4/6] 上传镜像到 NAS 并 load"
# 镜像已在 NAS 上则跳过传输（316MB 传一次要几分钟，重复部署不必重来）
NEED_IMAGES=$(ssh "$HOST" "docker images --format '{{.Repository}}:{{.Tag}}' | grep -c '^ppcoffe/api:latest$'" 2>/dev/null || echo 0)
if [[ "$NEED_IMAGES" == "0" ]]; then
    echo "    传输镜像包到 NAS..."
    scp -q "$LOCAL_IMAGE_TAR" "$HOST:$REMOTE_DIR/images.tar.gz"
    ssh "$HOST" "docker load -i '$REMOTE_DIR/images.tar.gz' && rm -f '$REMOTE_DIR/images.tar.gz'"
else
    echo "    镜像已存在（ppcoffe/api:latest），跳过传输"
fi

# web 构建上下文：先整体换成新目录再切换，避免旧的 hash 化产物残留
# （Taro 产物文件名带内容 hash，新版本构建后旧文件仍在，
#   而 index.html 只引用新的那个 —— 残留虽不影响运行，但会堆积）
ssh "$HOST" "cd '$REMOTE_DIR/web' && \
    rm -rf dist.new && mkdir -p dist.new && \
    tar -xzf /tmp/ppcoffe-webctx.tar.gz -C dist.new 2>/dev/null && \
    rm -rf dist.old && mv dist dist.old 2>/dev/null; mv dist.new dist && \
    rm -rf dist.old && rm -f /tmp/ppcoffe-webctx.tar.gz && \
    echo '    web 上下文已更新'"

# ======================================================================
say "[5/6] 生成 .env 并启动 compose"
# compose 里的相对路径（./backend、./web）都是相对 **项目根** 的，
# 所以 compose 文件要放在项目根，且从项目根执行。
ssh "$HOST" "cat > '$REMOTE_DIR/.env' <<EOF
# ---- 应用 ----
APP_ENV=production
PUBLIC_BASE_URL=${API_URL}
SECRET_KEY=${SECRET_KEY}
JWT_SECRET=${JWT_SECRET}
AUTH_MODE=${AUTH_MODE:-dev}
WECHAT_APPID=${WECHAT_APPID:-}
WECHAT_SECRET=${WECHAT_SECRET:-}

# ---- 端口（fnOS 上 80/443/8000/9000 等已被占用）----
API_PORT=${API_PORT}
WEB_PORT=${WEB_PORT}
MINIO_PORT=${MINIO_PORT}
MINIO_CONSOLE_PORT=${MINIO_CONSOLE_PORT}

# ---- 数据库：复用 fnOS 上已有的 mysql 容器（宿主机映射端口 ${MYSQL_PORT}）----
DATABASE_URL=mysql+pymysql://${MYSQL_APP_USER}:${MYSQL_APP_PASSWORD}@${DOCKER_HOST_GW}:${MYSQL_PORT}/ppcoffe?charset=utf8mb4
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_USER=${MYSQL_APP_USER}
MYSQL_PASSWORD=${MYSQL_APP_PASSWORD}
MYSQL_DATABASE=ppcoffe

# ---- 缓存 ----
REDIS_URL=redis://redis:6379/0
REDIS_PORT=16379

# ---- 对象存储 ----
STORAGE_DRIVER=minio
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_APP_ACCESS_KEY=${MINIO_APP_ACCESS_KEY}
MINIO_APP_SECRET_KEY=${MINIO_APP_SECRET_KEY}
# ⚠️ 必须与浏览器实际访问的 host:port 一致（SigV4 把 Host 算进签名）
MINIO_PUBLIC_ENDPOINT=${MINIO_PUBLIC_ENDPOINT_VALUE}
# 对外预签名协议：与对外 scheme 一致（TLS 在 frps 终止时为 https）
MINIO_PUBLIC_SECURE=${MINIO_PUBLIC_SECURE:-$([[ "${PUBLIC_SCHEME}" == "https" ]] && echo true || echo false)}
MINIO_PUBLIC_BASE_URL=
MINIO_BUCKET_BREW=ppcoffe-brew
MINIO_BUCKET_ROAST=ppcoffe-roast
MINIO_BUCKET_TEMP=ppcoffe-tmp

# ---- 构建参数 ----
PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
PIP_TRUSTED_HOST=mirrors.aliyun.com
GUNICORN_WORKERS=2
GUNICORN_THREADS=2
EOF"

# 初始化 MySQL 库与账号（在 compose 之外做，因为复用的是已有容器）
# 用 API 镜像里的 pymysql 直连：
#   - mysql 客户端镜像的标签在两台机器上不一致（8.4 / 8.4.1），且 bind mount 不可靠；
#   - 用已有 API 镜像，无需额外拉取。
cat > /tmp/ppcoffe-mysql-init.py <<PYEOF
import pymysql

conn = pymysql.connect(host="${DOCKER_HOST_GW}", port=${MYSQL_PORT},
                       user="${MYSQL_ROOT_USER}", password="${MYSQL_ROOT_PASSWORD}",
                       autocommit=True)
cur = conn.cursor()
cur.execute("CREATE DATABASE IF NOT EXISTS ppcoffe "
            "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
cur.execute("CREATE USER IF NOT EXISTS '${MYSQL_APP_USER}'@'%' IDENTIFIED BY '${MYSQL_APP_PASSWORD}'")
cur.execute("GRANT ALL PRIVILEGES ON ppcoffe.* TO '${MYSQL_APP_USER}'@'%'")
cur.execute("FLUSH PRIVILEGES")
print("    数据库与账号就绪")
PYEOF
scp -q /tmp/ppcoffe-mysql-init.py "$HOST:/tmp/ppcoffe-mysql-init.py"
ssh "$HOST" "docker run --rm -v /tmp/ppcoffe-mysql-init.py:/init.py:ro \
    --entrypoint python ppcoffe/api:latest /init.py 2>&1 | tail -3"

# compose 放在项目根执行（里面的相对路径 ./backend、./web 都相对项目根）
# compose 文件本体在 backend/ 下，所以从 backend/ 取再拷到根
ssh "$HOST" "cd '$REMOTE_DIR' && \
    cp -f backend/docker-compose.fnos.yml docker-compose.yml && \
    docker compose --profile minio build web && \
    docker compose --profile minio up -d --no-build 2>&1 | tail -20"

# ======================================================================
say "[6/6] 等待服务就绪"
# 一次 ssh 里循环等待，避免每轮都新建连接（SSH 建连在 NAS 上要几秒）
ssh "$HOST" "i=0; while [ \$i -lt 40 ]; do
    code=\$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${API_PORT}/api/v1/health 2>/dev/null || echo '')
    if [ \"\$code\" = '200' ]; then echo '    API 已就绪'; exit 0; fi
    i=\$((i + 1)); sleep 3
done
echo '❌ 等待超时'
cd '$REMOTE_DIR' && docker compose ps && docker compose logs --tail=40 api
exit 1"

# 建表 + 增量迁移 + 演示数据
# ⚠️ migrate 必须在 init-db 之后、seed 之前：
#    init-db 只建**新库**的表，migrate 才给**既有库**补新列（幂等，只增不删）。
#    豆仓分类实施新增了 beans.kind / beans.purchase_cost_cents /
#    roasts.roast_level 与 rest_events 表，靠这一步落到生产库。
ssh "$HOST" "cd '$REMOTE_DIR' && \
    docker compose exec -T api python manage.py init-db && \
    docker compose exec -T api python manage.py migrate && \
    docker compose exec -T api python manage.py seed" || true

echo ""
echo "✅ 部署完成"
echo ""
echo "   对外访问地址（浏览器实际用的）："
echo "   ┌─ H5 前端        ${WEB_URL}/"
echo "   ├─ API           ${API_URL}/api/v1"
echo "   ├─ MinIO S3      ${MINIO_URL}          (预签名直传入口)"
echo "   └─ MinIO 控制台   http://${NAS_IP}:${MINIO_CONSOLE_PORT}/   (仅内网)"
echo ""
echo "   容器内网地址（frpc local_port 用这些）："
echo "     web   → ${NAS_IP}:${WEB_PORT}"
echo "     api   → ${NAS_IP}:${API_PORT}"
echo "     minio → ${NAS_IP}:${MINIO_PORT}"
echo ""
echo "   常用运维："
echo "     ssh $HOST 'cd $REMOTE_DIR && docker compose ps'"
echo "     ssh $HOST 'cd $REMOTE_DIR && docker compose logs -f api'"
