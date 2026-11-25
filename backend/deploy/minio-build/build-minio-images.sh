#!/usr/bin/env bash
# 从源码构建 MinIO Server / Client 镜像（离线环境下的 MinIO 部署方案）
#
# 适用场景：Docker Hub 的第三方命名空间不可达（DNS 污染 / 镜像源只代理 library/），
#           且 MinIO 官方二进制已从 dl.min.io 下架（410，项目归档）。
#
# 流程：下载源码 → 装 Go（国内镜像）→ 编译静态二进制 → 打 Docker 镜像
#
#   ./build-minio-images.sh                 # 构建并打标签
#   MINIO_VERSION=... MC_VERSION=... ./build-minio-images.sh
#
# 产物标签与 docker-compose.yml 中引用的一致，无需改 compose 文件：
#   minio/minio:RELEASE.2025-04-22T22-12-26Z
#   minio/mc:RELEASE.2025-04-16T18-13-26Z
set -euo pipefail

MINIO_VERSION="${MINIO_VERSION:-RELEASE.2025-04-22T22-12-26Z}"
MC_VERSION="${MC_VERSION:-RELEASE.2025-04-16T18-13-26Z}"
GO_VERSION="${GO_VERSION:-go1.25.14}"
GO_MIRROR="${GO_MIRROR:-https://mirrors.aliyun.com/golang/}"
GOPROXY_CN="${GOPROXY_CN:-https://goproxy.cn,direct}"
WORK="${WORK:-/opt/build}"

echo "==> 准备构建目录: $WORK"
mkdir -p "$WORK/bin" "$WORK/images/minio" "$WORK/images/mc"

# ---- 1. Go 工具链 ----
if [ ! -x /usr/local/go/bin/go ]; then
    echo "==> 下载 Go $GO_VERSION"
    curl -fL --retry 5 --retry-delay 3 --connect-timeout 20 --max-time 900 \
        -o "$WORK/go.tgz" "${GO_MIRROR}${GO_VERSION}.linux-amd64.tar.gz"
    tar -C /usr/local -xzf "$WORK/go.tgz"
fi
export PATH=/usr/local/go/bin:$PATH
export GOPROXY="$GOPROXY_CN"
export GOSUMDB=sum.golang.google.cn
export GOPATH="$WORK/gopath"
export GOCACHE="$WORK/gocache"
export GOMAXPROCS="${GOMAXPROCS:-2}"
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64
go version

# ---- 2. MinIO Server ----
echo "==> 获取 MinIO 源码 $MINIO_VERSION"
if [ ! -d "$WORK/minio-$MINIO_VERSION" ]; then
    curl -fL --retry 5 --retry-delay 3 --connect-timeout 20 --max-time 900 \
        -o "$WORK/minio-src.tar.gz" \
        "https://codeload.github.com/minio/minio/tar.gz/refs/tags/$MINIO_VERSION"
    tar -C "$WORK" -xzf "$WORK/minio-src.tar.gz"
fi
echo "==> 编译 MinIO Server（较慢，耐心等）"
# 注意：MinIO 的 main 包在**仓库根目录**（main.go，package main），
# 而 ./cmd 是名为 cmd 的库包 —— 对它 go build 只会产出 .a 归档，不是可执行文件。
(cd "$WORK/minio-$MINIO_VERSION" && \
    go build -tags release -trimpath -ldflags "-s -w" -o "$WORK/bin/minio" .)
ls -lh "$WORK/bin/minio"
# 校验产物确实是 ELF 可执行文件（防止误用 ./cmd 这类库包）
head -c 4 "$WORK/bin/minio" | grep -q $'\x7fELF' || { echo "❌ 产物不是 ELF 可执行文件"; exit 1; }

# ---- 3. MinIO Client (mc) ----
echo "==> 获取 mc 源码 $MC_VERSION"
if [ ! -d "$WORK/mc-$MC_VERSION" ]; then
    curl -fL --retry 5 --retry-delay 3 --connect-timeout 20 --max-time 900 \
        -o "$WORK/mc-src.tar.gz" \
        "https://codeload.github.com/minio/mc/tar.gz/refs/tags/$MC_VERSION"
    tar -C "$WORK" -xzf "$WORK/mc-src.tar.gz"
fi
echo "==> 编译 mc"
# mc 的 main 包同样在仓库根目录
(cd "$WORK/mc-$MC_VERSION" && \
    go build -tags release -trimpath -ldflags "-s -w" -o "$WORK/bin/mc" .)
ls -lh "$WORK/bin/mc"
head -c 4 "$WORK/bin/mc" | grep -q $'\x7fELF' || { echo "❌ 产物不是 ELF 可执行文件"; exit 1; }

# ---- 4. 打镜像 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 构建镜像"
cp "$WORK/bin/minio" "$WORK/images/minio/minio"
cp "$WORK/bin/mc"    "$WORK/images/mc/mc"
# CA 证书从宿主拷贝（alpine 装包依赖外网，这里直接带进去）
cp /etc/ssl/certs/ca-certificates.crt "$WORK/images/minio/ca-certificates.crt" 2>/dev/null || true
cp /etc/ssl/certs/ca-certificates.crt "$WORK/images/mc/ca-certificates.crt" 2>/dev/null || true

docker build -q -t "minio/minio:$MINIO_VERSION" "$WORK/images/minio"
docker build -q -t "minio/mc:$MC_VERSION" "$WORK/images/mc"

echo "==> 完成，镜像列表："
docker images | grep -E "minio" || true
echo ""
echo "✅ 现在可以启用 MinIO 服务："
echo "   cd /opt/ppcoffe && docker compose --profile minio up -d"
