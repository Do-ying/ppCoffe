#!/bin/sh
# ppCoffe → fnOS NAS 远端准备脚本（由 deploy-fnos.sh 上传后执行）
#
# 单独成文件的原因：远程命令里嵌 if/fi 与多层引号极易被 ssh 的引号处理破坏，
# 写成脚本文件后由 NAS 自己解析，行为可预期。
#
# 环境变量（由调用方注入）：
#   REMOTE_DIR         部署根目录
#   API_PORT           API 端口
#   H5_PORT            H5 端口
#   MINIO_PORT         MinIO S3 端口
#   MINIO_CONSOLE_PORT MinIO 控制台端口
#   NAS_IP             NAS 内网地址
#   MYSQL_PORT         复用 MySQL 容器的宿主机映射端口
#   MYSQL_ROOT_USER / MYSQL_ROOT_PASSWORD
#   MYSQL_APP_USER / MYSQL_APP_PASSWORD
#   MINIO_ROOT_USER / MINIO_ROOT_PASSWORD
#   MINIO_APP_ACCESS_KEY / MINIO_APP_SECRET_KEY
#   ALPINE_MIRROR / MINIO_VERSION / MC_VERSION
set -eu

REMOTE_DIR="${REMOTE_DIR:-/home/xpw/ppcoffe}"
API_PORT="${API_PORT:-8080}"
H5_PORT="${H5_PORT:-8081}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-19001}"
NAS_IP="${NAS_IP:-192.168.31.13}"
# ⚠️ 凭据由调用方（deploy-fnos.sh）通过环境变量传入，
#    这里不设默认值 —— 缺失时直接失败，避免带着空密码去连库。
MYSQL_PORT="${MYSQL_PORT:-3360}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
MYSQL_APP_USER="${MYSQL_APP_USER:-ppcoffe}"
MYSQL_APP_PASSWORD="${MYSQL_APP_PASSWORD:-}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-ppcoffe-root}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
MINIO_APP_ACCESS_KEY="${MINIO_APP_ACCESS_KEY:-ppcoffe}"
MINIO_APP_SECRET_KEY="${MINIO_APP_SECRET_KEY:-}"
SECRET_KEY="${SECRET_KEY:-}"
JWT_SECRET="${JWT_SECRET:-}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://mirrors.aliyun.com/alpine}"
MINIO_VERSION="${MINIO_VERSION:-0.20250524.170830-r5}"
MC_VERSION="${MC_VERSION:-0.20250521.015954-r5}"

cd "$REMOTE_DIR"

# ---------------------------------------------------------------------
# 1. MinIO：Alpine musl 运行时 + 官方二进制
# ---------------------------------------------------------------------
echo "    准备 MinIO 运行时..."
mkdir -p minio-bin
cd minio-bin

if [ ! -x apk/usr/bin/minio ]; then
    echo "    下载 Alpine 包..."
    curl -sSL -m 300 -o minio.apk "$ALPINE_MIRROR/v3.22/community/x86_64/minio-${MINIO_VERSION}.apk"
    curl -sSL -m 300 -o mc.apk "$ALPINE_MIRROR/v3.22/community/x86_64/minio-client-${MC_VERSION}.apk"
    curl -sSL -m 120 -o musl.apk "$ALPINE_MIRROR/v3.22/main/x86_64/musl-1.2.5-r13.apk"
    mkdir -p apk mcpkg muslpkg
    ( cd apk    && tar -xzf ../minio.apk 2>/dev/null )
    ( cd mcpkg  && tar -xzf ../mc.apk 2>/dev/null )
    ( cd muslpkg && tar -xzf ../musl.apk 2>/dev/null )
    rm -f minio.apk mc.apk musl.apk
fi

# fnOS 是 glibc，MinIO 二进制是 musl 动态链接 —— 用 musl loader 当解释器
cat > minio-run.sh <<EOF
#!/bin/sh
exec $REMOTE_DIR/minio-bin/muslpkg/lib/ld-musl-x86_64.so.1 --library-path $REMOTE_DIR/minio-bin/muslpkg/lib $REMOTE_DIR/minio-bin/apk/usr/bin/minio "\$@"
EOF
cat > mc-run.sh <<EOF
#!/bin/sh
exec $REMOTE_DIR/minio-bin/muslpkg/lib/ld-musl-x86_64.so.1 --library-path $REMOTE_DIR/minio-bin/muslpkg/lib $REMOTE_DIR/minio-bin/mcpkg/usr/bin/mcli "\$@"
EOF
chmod +x minio-run.sh mc-run.sh
./minio-run.sh --version | head -1

cd "$REMOTE_DIR"

# ---------------------------------------------------------------------
# 2. MySQL：复用 fnOS 上已有的 mysql 容器
# ---------------------------------------------------------------------
echo "    准备 MySQL（复用已有容器，宿主机端口 ${MYSQL_PORT}）..."
.venv/bin/python - "$MYSQL_PORT" "$MYSQL_ROOT_USER" "$MYSQL_ROOT_PASSWORD" \
    "$MYSQL_APP_USER" "$MYSQL_APP_PASSWORD" <<'PYEOF'
import sys
import pymysql

port, root_user, root_pw, app_user, app_pw = (
    int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
)
conn = pymysql.connect(host="127.0.0.1", port=port, user=root_user,
                       password=root_pw, autocommit=True)
cur = conn.cursor()
cur.execute("CREATE DATABASE IF NOT EXISTS ppcoffe "
            "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
# 用拼接而不是参数占位：用户名里的 '%' 会和 pymysql 的占位语法混淆
cur.execute("CREATE USER IF NOT EXISTS '" + app_user + "'@'%' IDENTIFIED BY '"
            + app_pw + "'")
cur.execute("GRANT ALL PRIVILEGES ON ppcoffe.* TO '" + app_user + "'@'%'")
cur.execute("FLUSH PRIVILEGES")
print("    数据库与账号就绪")
PYEOF

# ---------------------------------------------------------------------
# 3. 生成 .env / .minio-env
# ---------------------------------------------------------------------
echo "    生成配置..."
cat > .env <<EOF
APP_ENV=production
HOST=0.0.0.0
PORT=${API_PORT}
PUBLIC_BASE_URL=http://${NAS_IP}:${API_PORT}
SECRET_KEY=${SECRET_KEY}
JWT_SECRET=${JWT_SECRET}
AUTH_MODE=${AUTH_MODE:-dev}
CORS_ORIGINS=*
SQLALCHEMY_ECHO=false
SQLALCHEMY_POOL_SIZE=10
SQLALCHEMY_POOL_RECYCLE=280

# ---- MySQL 8（复用 fnOS 上已有的 mysql 容器，宿主机映射端口 ${MYSQL_PORT}）----
DATABASE_URL=mysql+pymysql://${MYSQL_APP_USER}:${MYSQL_APP_PASSWORD}@127.0.0.1:${MYSQL_PORT}/ppcoffe?charset=utf8mb4

# ---- Redis 未启用（后端自动降级为实时计算）----
REDIS_URL=

# ---- 对象存储：NAS 上自建 MinIO ----
STORAGE_DRIVER=minio
MINIO_ENDPOINT=127.0.0.1:${MINIO_PORT}
MINIO_PUBLIC_ENDPOINT=${NAS_IP}:${MINIO_PORT}
MINIO_ACCESS_KEY=${MINIO_APP_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_APP_SECRET_KEY}
MINIO_SECURE=false
MINIO_REGION=us-east-1
MINIO_PUBLIC_BASE_URL=
MINIO_BUCKET_BREW=ppcoffe-brew
MINIO_BUCKET_ROAST=ppcoffe-roast
MINIO_BUCKET_TEMP=ppcoffe-tmp
MINIO_URL_TTL=604800
LOCAL_STORAGE_ROOT=${REMOTE_DIR}/var/uploads
EOF

cat > .minio-env <<EOF
MINIO_ROOT_USER=${MINIO_ROOT_USER}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_APP_ACCESS_KEY=${MINIO_APP_ACCESS_KEY}
MINIO_APP_SECRET_KEY=${MINIO_APP_SECRET_KEY}
MINIO_BUCKET_BREW=ppcoffe-brew
MINIO_BUCKET_ROAST=ppcoffe-roast
MINIO_BUCKET_TEMP=ppcoffe-tmp
EOF

mkdir -p var/uploads var/minio-data var/mc-config

# ---------------------------------------------------------------------
# 4. 建表 + 演示数据
# ---------------------------------------------------------------------
echo "    建表并灌入演示数据..."
.venv/bin/python manage.py init-db
.venv/bin/python manage.py seed

# ---------------------------------------------------------------------
# 5. 启动 MinIO + 初始化桶与受限账号
# ---------------------------------------------------------------------
echo "    启动 MinIO 并初始化桶..."
set -a
. ./.minio-env
set +a

MC="./minio-bin/mc-run.sh --config-dir ${REMOTE_DIR}/var/mc-config"

if ! curl -s -m 5 -o /dev/null "http://127.0.0.1:${MINIO_PORT}/minio/health/live"; then
    setsid nohup ./minio-bin/minio-run.sh server "$REMOTE_DIR/var/minio-data" \
        --address ":${MINIO_PORT}" --console-address ":${MINIO_CONSOLE_PORT}" \
        > var/minio.log 2>&1 < /dev/null &
    # 等待就绪
    i=0
    while [ $i -lt 30 ]; do
        if curl -s -m 3 -o /dev/null "http://127.0.0.1:${MINIO_PORT}/minio/health/live"; then
            break
        fi
        i=$((i + 1))
        sleep 2
    done
fi

$MC alias set local "http://127.0.0.1:${MINIO_PORT}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
for b in "$MINIO_BUCKET_BREW" "$MINIO_BUCKET_ROAST" "$MINIO_BUCKET_TEMP"; do
    $MC mb --ignore-existing "local/$b" >/dev/null 2>&1 || true
done
$MC admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY" >/dev/null 2>&1 || true
$MC admin policy create local ppcoffe "$REMOTE_DIR/minio-policy.json" >/dev/null 2>&1 || true
$MC admin policy attach local ppcoffe --user "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1 || true
$MC ilm rule add --expire-days 30 "local/$MINIO_BUCKET_TEMP" >/dev/null 2>&1 || true
echo "    桶与受限账号就绪"

# ---------------------------------------------------------------------
# 6. systemd user 单元
# ---------------------------------------------------------------------
echo "    安装 systemd 单元..."
UNIT_DIR="/home/xpw/.config/systemd/user"
mkdir -p "$UNIT_DIR"

cat > "$UNIT_DIR/ppcoffe-minio.service" <<EOF
[Unit]
Description=ppCoffe MinIO (S3 object storage)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
EnvironmentFile=${REMOTE_DIR}/.minio-env
ExecStart=${REMOTE_DIR}/minio-bin/minio-run.sh server ${REMOTE_DIR}/var/minio-data --address ":${MINIO_PORT}" --console-address ":${MINIO_CONSOLE_PORT}"
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=append:${REMOTE_DIR}/var/minio.log
StandardError=append:${REMOTE_DIR}/var/minio.log

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/ppcoffe-api.service" <<EOF
[Unit]
Description=ppCoffe API (Flask + gunicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
Environment=GUNICORN_BIND=0.0.0.0:${API_PORT}
Environment=GUNICORN_WORKERS=2
Environment=GUNICORN_THREADS=2
Environment=GUNICORN_LOG_LEVEL=info
ExecStart=${REMOTE_DIR}/.venv/bin/gunicorn -c ${REMOTE_DIR}/gunicorn.conf.py wsgi:app
Restart=always
RestartSec=5
StandardOutput=append:${REMOTE_DIR}/var/gunicorn.log
StandardError=append:${REMOTE_DIR}/var/gunicorn.log

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/ppcoffe-h5.service" <<EOF
[Unit]
Description=ppCoffe H5 static site server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_DIR}
ExecStart=${REMOTE_DIR}/.venv/bin/python ${REMOTE_DIR}/serve_h5.py --root ${REMOTE_DIR}/web --port ${H5_PORT}
Restart=always
RestartSec=5
StandardOutput=append:${REMOTE_DIR}/var/h5.log
StandardError=append:${REMOTE_DIR}/var/h5.log

[Install]
WantedBy=default.target
EOF

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user daemon-reload
systemctl --user enable --now ppcoffe-minio.service ppcoffe-api.service ppcoffe-h5.service
systemctl --user restart ppcoffe-api.service ppcoffe-h5.service

echo "    远端准备完成"
