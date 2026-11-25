# 本地构建的 MinIO Client (mc) 镜像
#
# 用途：minio-init 任务用它建桶、设生命周期、创建应用账号。
FROM alpine:3.21

COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

COPY mc /usr/local/bin/mc
RUN chmod +x /usr/local/bin/mc

ENTRYPOINT ["/usr/local/bin/mc"]
CMD ["--version"]
