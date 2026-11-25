# ppCoffe · MinIO 运行时镜像（自建）
#
# 为什么不用官方 minio/minio 镜像？
#
#   1) Docker Hub 在本机网络被 DNS 污染：registry-1.docker.io / auth.docker.io
#      只解析到 Meta 的 IPv6 地址（2a03:2880:...），直连必然超时；
#   2) 国内镜像源（daocloud / 1ms / hub.rat.dev 等）对 minio/minio 这类
#      「第三方命名空间」一律返回 403 / denied —— 镜像源只代理 library/ 官方镜像；
#   3) MinIO 开源版（社区版）已由官方归档，dl.min.io 返回 410，官方镜像不再更新。
#
# 替代路径：Alpine 社区仓库收录了 MinIO 服务端二进制，
#   且 mirrors.aliyun.com 在阿里云 ECS 上内网直连、高速稳定。
#   基础镜像用 library/alpine（可正常拉取），再从 Alpine 源安装 minio + minio-client。
#
# 产物版本：minio 0.20250524.170830-r5 → MinIO RELEASE.2025-05-24T17-08-30Z
#
# 构建：
#   docker build -t ppcoffe/minio:alpine-20250524 minio/
FROM alpine:3.22

# 换到阿里云镜像源（ECS 内网直连，不走公网）
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.aliyun.com/alpine|g' \
        /etc/apk/repositories \
 && apk add --no-cache minio minio-client \
 && rm -rf /var/cache/apk/* \
 && minio --version \
 && mc --version

# MinIO 服务端默认账号（生产请在 .env 中覆盖）
ENV MINIO_ROOT_USER=minioadmin \
    MINIO_ROOT_PASSWORD=minioadmin \
    MINIO_BROWSER_REDIRECT_URL=http://127.0.0.1:9001

# 9000 = S3 兼容 API（预签名直传走这里）；9001 = Web 控制台
EXPOSE 9000 9001

VOLUME /data

# Alpine 包已内置 minio 账号，但 named volume 默认为 root 属主，
# 这里以 root 运行以保证 /data 可写（个人部署场景，资源隔离靠 Docker 本身）。
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
