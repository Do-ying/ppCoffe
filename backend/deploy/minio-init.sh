#!/bin/sh
# MinIO 初始化：建桶 + 生命周期规则 + 应用专用受限账号
#
# 由 docker-compose 的 minio-init 服务在 minio 健康后执行一次。
# 应用不使用 root 凭据，而是用只对三个业务桶授权的 ppcoffe 账号。
set -e

BUCKET_BREW="${MINIO_BUCKET_BREW:-ppcoffe-brew}"
BUCKET_ROAST="${MINIO_BUCKET_ROAST:-ppcoffe-roast}"
BUCKET_TEMP="${MINIO_BUCKET_TEMP:-ppcoffe-tmp}"

echo "==> 连接 MinIO"
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

echo "==> 创建桶"
for b in "$BUCKET_BREW" "$BUCKET_ROAST" "$BUCKET_TEMP"; do
    mc mb --ignore-existing "local/$b"
done

echo "==> 临时桶生命周期（30 天自动清理孤儿对象）"
mc ilm rule add --expire-days 30 "local/$BUCKET_TEMP" 2>/dev/null || \
    echo "   （规则已存在，跳过）"

echo "==> 创建应用账号"
if mc admin user info local "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1; then
    echo "   账号已存在，更新密钥"
    mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY" --quiet 2>/dev/null || \
        mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
else
    mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
fi

echo "==> 绑定桶级权限策略"
mc admin policy create local ppcoffe /init/minio-policy.json 2>/dev/null || true
mc admin policy attach local ppcoffe --user "$MINIO_APP_ACCESS_KEY"

echo "==> 桶列表"
mc ls local

echo "✅ MinIO 初始化完成"
