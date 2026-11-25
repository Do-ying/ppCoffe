# ppCoffe · fnOS NAS 部署记录（Docker 版）★ 主方案

> 面向运维/部署。接口契约见 `docs/02-接口契约.md`，
> 阿里云 ECS 版见 `docs/03-后端部署方案.md`，
> 无 Docker 的备选方案见 `docs/04-fnOS部署记录.md`。
>
> **本篇是 fnOS 上的主方案：整个项目（前端 + 后端 + 数据库 + 对象存储）全部容器化。**

---

## 0. 结论速览

| 项 | 值 |
|---|---|
| SSH 别名 | `fnos`（`~/.ssh/config`，117.152.216.114:8185，用户 `xpw`） |
| 主机名 | `xpwFN`（Debian 系 / 内核 6.18.18 / x86_64 / 4 核 / 23 GB） |
| **部署目录** | **`/vol2/1000/public/ppcoffe`** |
| NAS 内网地址 | `192.168.31.13` |
| 数据库 | 复用 NAS 上已有的 `mysql:8.4.1` 容器（宿主机映射端口 **3360**） |
| 对象存储 | MinIO（自建镜像，Alpine musl 运行时） |
| 前端 | nginx 容器托管 Taro H5 产物 + 反代 `/api/` |

### 容器与端口

| 端口 | 容器 | 服务 | 说明 |
|---|---|---|---|
| **8081** | `ppcoffe-web` | H5 前端 | nginx，**对外入口，frp 代理这个** |
| **8080** | `ppcoffe-api` | API | Flask + gunicorn |
| **19000** | `ppcoffe-minio` | MinIO S3 | 预签名直传入口，**frp 也要代理** |
| 19001 | `ppcoffe-minio` | MinIO 控制台 | 仅内网，建议 SSH 隧道 |
| 16379 | `ppcoffe-redis` | Redis 7 | 可选缓存层 |

> fnOS 上 80 / 443 / 3000 / 3001 / 8000 / 9000 等已被系统与其他容器占用，故另开端口。

---

## 1. 容器拓扑

```
                      ┌─────────────────────────────────────┐
   浏览器 ──────────▶ │  ppcoffe-web  (nginx:1.27-alpine)   │
                      │  :8081                              │
                      │    /            → H5 静态产物        │
                      │    /api/        → api:8000          │
                      └──────────────┬──────────────────────┘
                                     │
                      ┌──────────────▼──────────────────────┐
                      │  ppcoffe-api  (Flask + gunicorn)     │
                      │  :8080                               │
                      └───┬─────────────────────────┬────────┘
                          │                         │
         ┌────────────────▼──────────┐   ┌──────────▼─────────────────┐
         │ 复用 fnOS 已有 MySQL 容器   │   │  ppcoffe-minio  (自建镜像) │
         │  宿主机 3360 → 容器网桥      │   │  :19000 S3 / :19001 控制台  │
         │  DATABASE_URL@172.17.0.1   │   │  预签名直传目标            │
         └───────────────────────────┘   └────────────────────────────┘
                          │
         ┌────────────────▼──────────┐
         │  ppcoffe-redis (可选缓存)   │
         └───────────────────────────┘
```

---

## 2. 部署步骤

### 2.1 前置条件（需你协助一次）

fnOS 上 `xpw` 用户**不在 `docker` 组**，无法访问 docker socket：

```
$ docker ps
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

```bash
$ sudo -n -l
sudo: a password is required      # sudo 需要交互密码，无法自动化
```

**解决方式（任选其一，都只需执行一次）：**

| 方式 | 操作 | 说明 |
|---|---|---|
| A · 命令行 | `sudo usermod -aG docker xpw` | 之后**重新 SSH 登录**生效（组变更需重登录） |
| B · 图形界面 | fnOS 管理界面 → 用户/用户组 → 把 `xpw` 加入 `docker` 组 | 同上，需重新登录 |
| C · sudoers | `sudo visudo` 加一条**窄规则**限定 docker 相关命令免密 | 只授权必要命令，不放开全部 |

> ⚠️ 加组后必须**重新建立 SSH 连接**才生效 —— 当前会话的进程组是在登录时固定的。
> 验证：`docker ps` 不再报 permission denied 即可。

> 本方案**不需要**修改 `/etc/docker/daemon.json`：
> 镜像通过 `docker load` 导入，web 镜像本地构建，都不依赖 registry 镜像源。
> （fnOS 自带的三个镜像源 `ustc` / `fnnas` / `hub.docker.com` 实测都不可用，
> 但本方案绕开了它们。）

### 2.2 一键部署

```bash
cd backend
bash deploy/deploy-fnos-docker.sh fnos 192.168.31.13
```

流程：同步项目 → 本地构建 H5 → 传输镜像 → `docker load` → 生成 `.env` →
初始化 MySQL 库 → `docker compose up` → 建表 + 演示数据 → 等待就绪。

**幂等**，可重复执行。

### 2.3 手动步骤（排查用）

```bash
# 1) 同步项目
rsync -az --exclude='.git/' --exclude='node_modules/' --exclude='dist/' \
      --exclude='dist-h5*/' --exclude='tmp/' --exclude='_mcp_*.py' \
      --exclude='backend/.venv/' --exclude='backend/var/' \
      --exclude='backend/__pycache__/' --exclude='backend/.env' \
      ./ fnos:/vol2/1000/public/ppcoffe/

# 2) 构建 H5（本地，注入 NAS 地址）
cd ..
TARO_APP_OUTPUT_ROOT=tmp/dist-fnos-docker \
TARO_APP_API_BASE_URL=http://192.168.31.13:8080/api/v1 \
    npx taro build --type h5

# 3) 组装 web 构建上下文
mkdir -p tmp/webctx && cp -R tmp/dist-fnos-docker tmp/webctx/dist
cp backend/deploy/nginx-fnos.conf tmp/webctx/nginx.conf
cp backend/deploy/web.Dockerfile  tmp/webctx/Dockerfile
rsync -az tmp/webctx/ fnos:/vol2/1000/public/ppcoffe/web/

# 4) 导入镜像（阿里云中转机上已备好合并包）
scp aliyun:/tmp/ppcoffe-all.tar.gz /tmp/
scp /tmp/ppcoffe-all.tar.gz fnos:/vol2/1000/public/ppcoffe/images.tar.gz
ssh fnos 'docker load -i /vol2/1000/public/ppcoffe/images.tar.gz'

# 5) 生成 .env（见 2.4）并启动
ssh fnos 'cd /vol2/1000/public/ppcoffe && \
    cp backend/docker-compose.fnos.yml docker-compose.yml && \
    docker compose --profile minio build web && \
    docker compose --profile minio up -d --no-build'

# 6) 建表 + 演示数据
ssh fnos 'cd /vol2/1000/public/ppcoffe && \
    docker compose exec -T api python manage.py init-db && \
    docker compose exec -T api python manage.py seed'
```

### 2.4 `.env` 配置

`/vol2/1000/public/ppcoffe/.env`（由脚本自动生成）：

```env
APP_ENV=production
PUBLIC_BASE_URL=http://192.168.31.13:8080
SECRET_KEY=<生产密钥>
JWT_SECRET=<生产密钥>
AUTH_MODE=dev

API_PORT=8080
WEB_PORT=8081
MINIO_PORT=19000
MINIO_CONSOLE_PORT=19001

# 复用 fnOS 上已有的 mysql 容器（宿主机映射端口 3360）
# 容器内访问宿主机走 docker0 网关 172.17.0.1
DATABASE_URL=mysql+pymysql://ppcoffe:<密码>@172.17.0.1:3360/ppcoffe?charset=utf8mb4
MYSQL_ROOT_PASSWORD=<改成实际密码>
MYSQL_USER=ppcoffe
MYSQL_PASSWORD=<应用密码>
MYSQL_DATABASE=ppcoffe

REDIS_URL=redis://redis:6379/0
STORAGE_DRIVER=minio
MINIO_ROOT_USER=ppcoffe-root
MINIO_ROOT_PASSWORD=<root密码>
MINIO_APP_ACCESS_KEY=ppcoffe
MINIO_APP_SECRET_KEY=<应用密钥>
# ⚠️ 必须与浏览器实际访问的 host:port 一致（SigV4 把 Host 算进签名）
MINIO_PUBLIC_ENDPOINT=192.168.31.13:19000
MINIO_BUCKET_BREW=ppcoffe-brew
MINIO_BUCKET_ROAST=ppcoffe-roast
MINIO_BUCKET_TEMP=ppcoffe-tmp

PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
PIP_TRUSTED_HOST=mirrors.aliyun.com
```

> `AUTH_MODE` 当前为 `dev`（code 直接当 openid），便于联调。
> 小程序正式发布前需改为 `wechat` 并填 `WECHAT_APPID` / `WECHAT_SECRET`。

---

## 3. 镜像策略

fnOS 自带的三个镜像源实测都不可用：

| 镜像源 | 实测结果 |
|---|---|
| `docker.mirrors.ustc.edu.cn` | ❌ 不可达（000） |
| `docker.fnnas.com` | ❌ 401（需鉴权） |
| `registry.hub.docker.com` | ❌ DNS 污染（000） |

**本方案完全绕开镜像源**，两条路径：

| 镜像 | 来源 |
|---|---|
| `nginx:1.27-alpine` `redis:7-alpine` `alpine:3.22` `python:3.12-slim` | 阿里云中转机 `docker save` → SCP → `docker load` |
| `ppcoffe/api:latest` | 同上（阿里云上已构建，代码与本地 md5 一致） |
| `ppcoffe/minio:alpine-20250524` | 同上（Alpine musl 运行时） |
| `ppcoffe/web:latest` | NAS 上 `docker compose build web`（基础镜像 nginx 已在本地） |

> 阿里云中转机上的合并包：`/tmp/ppcoffe-all.tar.gz`（约 316 MB）。

### 3.1 MinIO 离线镜像

MinIO 官方二进制已 410 Gone（开源版归档），Alpine 社区包可用但是 **musl 动态链接**，
而 Alpine 基础镜像自带 musl —— 所以基础镜像用 `alpine:3.22`，二进制由构建上下文带入：

```dockerfile
FROM alpine:3.22
COPY minio /usr/bin/minio
COPY mc /usr/bin/mc
RUN chmod +x /usr/bin/minio /usr/bin/mc && minio --version && mc --version
```

二进制放在 `backend/minio/{minio,mc}`（已 `.gitignore`，不入库）。
`mc` 包里可执行文件叫 `mcli`，Dockerfile 中重命名为 `mc`。

---

## 4. 关键约束

### 4.1 SigV4 签名与 Host

**SigV4 把 `Host` 算进签名**，所以走 frp 对外暴露时有两个地址必须同时改：

| 配置项 | 内网值 | 走 frp 后 |
|---|---|---|
| H5 产物里的 `TARO_APP_API_BASE_URL` | `http://192.168.31.13:8080/api/v1` | `http://<对外地址>:<端口>/api/v1` |
| `.env` 的 `MINIO_PUBLIC_ENDPOINT` | `192.168.31.13:19000` | `<对外地址>:<端口>` |

最省事：

```bash
NAS_IP=<对外地址> bash deploy/deploy-fnos-docker.sh fnos <对外地址>
```

### 4.2 为什么 S3 不能走 nginx 路径转发

`minio-py` 的 `presigned_put_object` **只接受 `host:port`，无法携带路径前缀**；
且 SigV4 把 canonical URI 算进签名，nginx 一旦加 `/s3/` 前缀就会
`SignatureDoesNotMatch`。

所以 MinIO **单独暴露端口**（19000），`nginx-fnos.conf` 里只反代 `/api/`。

### 4.3 容器访问宿主机 MySQL

`host.docker.internal` 在 Linux 上默认不解析。已实测 `172.17.0.1:3360`（docker0 网关）
可直达宿主机上那个 MySQL 容器，故：

```yaml
extra_hosts:
  - "host.docker.internal:172.17.0.1"
```

---

## 5. frp 配置

你的 frp 服务器是 `124.220.199.223:7000`，已用到 **4010**，下一个可用 **4011**。
在 `/vol2/1000/public/frpc/frpc.toml` 追加：

```toml
[ppcoffe-web]
type = tcp
local_ip = 192.168.31.13
local_port = 8081
remote_port = 4011

[ppcoffe-api]
type = tcp
local_ip = 192.168.31.13
local_port = 8080
remote_port = 4012

[ppcoffe-minio]
type = tcp
local_ip = 192.168.31.13
local_port = 19000
remote_port = 4013
```

> ⚠️ **三个都要代理**，MinIO 的 19000 不能省 —— 前端直传图片走 S3 预签名 PUT。
> 代理后记得按 4.1 改地址并重建前端。

---

## 6. 验收结果

在 fnOS 上实测（2026-11-24）：

| 检查项 | 结果 |
|---|---|
| `docker load` | ✅ 6 个镜像全部导入（nginx / redis / alpine / python / api / minio） |
| `docker compose ps` | ✅ 4 个服务 Up：web / api / minio / redis |
| API 健康检查 | ✅ `{"ok":true,"database":"ok","redis":"ok","storage":"minio"}` |
| web 容器 H5 首页 | ✅ 200 `text/html` |
| web 容器代理 `/api/` | ✅ 200，返回健康检查 JSON |
| H5 产物内 API 地址 | ✅ `http://192.168.31.13:8080/api/v1` 已注入 |
| MinIO 健康检查 | ✅ 200 |
| MinIO 桶初始化 | ✅ `minio-init` Exited(0)：3 桶 + 30 天生命周期 + 应用账号 `ppcoffe` + 策略绑定 |
| MySQL 建表 + 数据 | ✅ beans 3 / brews 4 / brew_curves 4 / roasts 1 / roast_curves 1 / equipment 8 |
| 登录 `POST /api/v1/auth/wechat` | ✅ 签发 JWT（235 字符） |
| 元数据 `GET /api/v1/methods` | ✅ 返回冲煮方式列表 |
| MinIO 预签名 | ✅ 返回带 SigV4 签名的 uploadUrl（host `192.168.31.13:19000`） |
| **预签名直传 PUT** | ✅ **200**，对象确认落桶（9B） |
| 部署脚本幂等重跑 | ✅ 服务正常（约 2 分钟，镜像已在 NAS 上会跳过传输） |

> 备注：`mc ls` 在不带 root 凭据时报 Access Denied 属预期 ——
> 这正说明应用账号 `ppcoffe` 的权限隔离生效（只能访问那三个业务桶）。

---

## 7. 排查备忘

| 现象 | 原因 / 处理 |
|---|---|
| `docker ps` 报 permission denied | `xpw` 不在 docker 组；`sudo usermod -aG docker xpw` 后**重新登录** |
| 加了组还是 permission denied | 没重新建立 SSH 连接 —— 组变更需重登录 |
| `minio-init` 报 `can't open /init/minio-init.sh` | compose 的相对路径是相对**项目根**的；挂载应为 `./backend/deploy:/init:ro` |
| `mc` 连不上 / Access Denied | 应用账号只能访问那三个业务桶；用 root 凭据排查 |
| `docker run mysql:8.4` 报拉取超时 | 该标签本地不存在（实际是 `mysql:8.4.1`），且镜像源不可达；改用 API 镜像里的 pymysql 直连 |
| bind mount 宿主 SQL 文件到容器失败 | 该环境下不可靠；改用 `docker compose run` 或把脚本内容写进容器 |
| `docker load` 报镜像不存在 | 传输包损坏，重新从阿里云取（`gzip -t` 校验） |
| compose 报变量缺失 | `.env` 未生成，先跑部署脚本 |
| 容器连不上 MySQL | 用 `172.17.0.1`（docker0 网关）而非 `host.docker.internal` |
| 直传报 403 SignatureDoesNotMatch | 签名端点与浏览器实际访问的 host 不一致（见 4.1） |
| 预签名 PUT 返回 000 | 该端口没代理，或签名 host 与访问地址不符 |
| 部署脚本报 tar/rsync 超时 | 项目在飞牛同步盘上，排除 `_mcp_*.py` 等临时文件；见下方说明 |
| API 有数据但前端列表为空 | `ensure_owner` 用户级隔离，演示数据 `user_id=NULL` 归属「无主」（阿里云版一致） |

### 同步盘上的坑

项目位于**飞牛同步盘**，有三个实测问题：

1. **不保留可执行权限** → 用 `bash deploy/xxx.sh` 调用，别用 `./deploy/xxx.sh`
2. **部分临时文件读取会超时**（`_mcp_*.py` 等）→ rsync 时排除，
   或先在本地删除（这些是未跟踪的探测文件）
3. **`tar` 递归打包会跳过 `backend/`**（bsdtar 3.5.3 的 SEEK_HOLE 问题）

**用 rsync 同步更可靠**（部署脚本已改用 rsync）。
