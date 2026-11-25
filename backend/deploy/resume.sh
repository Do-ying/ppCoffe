#!/usr/bin/env bash
# 假死恢复后的「一键收尾」
#
#   ./deploy/resume.sh aliyun
#
# 依次完成：
#   1. 加 2GB swap（防内存颠簸复发）
#   2. 合并 MinIO 配置进远端 .env（密钥自动生成，已存在则保留）
#   3. 构建并启动 MinIO + 初始化桶与受限账号
#   4. 切 STORAGE_DRIVER=minio 并重建 API
#   5. 健康检查 + 预签名直传自检
set -euo pipefail

HOST="${1:-aliyun}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ppcoffe}"
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/5 加 swap（防复发）"
ssh "$HOST" "bash -s" <<'EOS'
set -e
if swapon --show=NAME --noheadings | grep -q '/swapfile'; then
  echo "    swap 已就绪"
else
  SWAP_PATH=/swapfile
  if findmnt -no FSTYPE / | grep -q btrfs; then
    echo "    检测到 btrfs，需要 chattr +C"
    touch "$SWAP_PATH" && chattr +C "$SWAP_PATH" || true
    dd if=/dev/zero of="$SWAP_PATH" bs=1M count=2048 status=none
  else
    dd if=/dev/zero of="$SWAP_PATH" bs=1M count=2048 status=none
  fi
  chmod 600 "$SWAP_PATH"
  mkswap "$SWAP_PATH" >/dev/null
  swapon "$SWAP_PATH"
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    已创建并启用 2GB swap"
fi
free -m | sed -n '1,3p'
EOS

echo "==> 2/5 合并 MinIO 配置到远端 .env"
ssh "$HOST" "python3 - '$REMOTE_DIR/.env' <<'PYEOF'
import secrets, string, sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8') if path.exists() else ''

lines = text.splitlines()
existing = {}
order = []
for line in lines:
    if '=' in line and not line.strip().startswith('#'):
        k = line.split('=', 1)[0].strip()
        existing[k] = line.split('=', 1)[1]
        order.append(k)
    else:
        order.append(None)

def rand(n=32):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(n))

def setv(key, value):
    if key in existing:
        existing[key] = value
    else:
        existing[key] = value
        order.append(key)

# 密钥：已存在则保留，未存在则生成
def keep_or_gen(key, gen):
    cur = existing.get(key, '').strip()
    if cur and not cur.startswith('change-me'):
        return cur
    val = gen()
    setv(key, val)
    return val

root_pw = keep_or_gen('MINIO_ROOT_PASSWORD', lambda: rand(40))
app_ak = keep_or_gen('MINIO_APP_ACCESS_KEY', lambda: 'ppcoffe')
app_sk = keep_or_gen('MINIO_APP_SECRET_KEY', lambda: rand(40))

setv('STORAGE_DRIVER', 'minio')
setv('MINIO_ENDPOINT', 'minio:9000')
# 预签名走 nginx 的 80 端口：S3 API 由 nginx 反代到 minio:9000，
# 路径与 Host 原样透传（SigV4 把 host 算进签名，不能改写）。
# 好处：小程序「合法域名」只需配一个 80/443 端口，不用额外放行 9000。
setv('MINIO_PUBLIC_ENDPOINT', '118.190.152.29:80')
setv('MINIO_ROOT_USER', existing.get('MINIO_ROOT_USER', 'minioadmin').strip() or 'minioadmin')
setv('MINIO_ROOT_PASSWORD', root_pw)
setv('MINIO_APP_ACCESS_KEY', app_ak)
setv('MINIO_APP_SECRET_KEY', app_sk)
setv('MINIO_REGION', 'us-east-1')
setv('MINIO_BUCKET_BREW', 'ppcoffe-brew')
setv('MINIO_BUCKET_ROAST', 'ppcoffe-roast')
setv('MINIO_BUCKET_TEMP', 'ppcoffe-tmp')

out = []
seen = set()
for k in order:
    if k is None:
        continue
    if k in seen:
        continue
    seen.add(k)
    out.append(f'{k}={existing[k]}')
for k, v in existing.items():
    if k not in seen:
        out.append(f'{k}={v}')

path.write_text('\n'.join(out) + '\n', encoding='utf-8')
print('    .env 已更新（MinIO 相关键已就绪）')
PYEOF"

echo "==> 3/5 构建并启动 MinIO"
bash "$BACKEND_DIR/deploy/deploy.sh" "$HOST" --minio

echo "==> 4/5 切 STORAGE_DRIVER=minio 并重建 API"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build api && docker compose up -d nginx"

echo "==> 5/5 健康检查"
for i in $(seq 1 30); do
    status=$(ssh "$HOST" "cd '$REMOTE_DIR' && docker compose ps api --format '{{.Status}}'" 2>/dev/null || echo "")
    if [[ "$status" == *"healthy"* ]]; then break; fi
    [[ $i -eq 30 ]] && { echo "❌ API 等待超时"; ssh "$HOST" "cd '$REMOTE_DIR' && docker compose logs --tail=40 api"; exit 1; }
    sleep 3
done

ssh "$HOST" "curl -s -m 10 http://127.0.0.1/api/v1/health"
echo ""
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
echo ""
echo "✅ 收尾完成"
