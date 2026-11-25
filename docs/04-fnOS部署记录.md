# ppCoffe · fnOS NAS 部署记录

> 面向运维/部署。完整架构与接口契约见 `docs/03-后端部署方案.md`。
> 本篇记录 **飞牛 NAS（fnOS）** 上的部署方式，与阿里云 ECS 版并存。

---

## 0. 结论速览

前端、后端、对象存储 **均已部署到 fnOS NAS**，通过 SSH 别名 `fnos` 操作，**全程无需 Docker**。

| 项 | 值 |
|---|---|
| SSH 别名 | `fnos`（`~/.ssh/config`，117.152.216.114:8185，用户 `xpw`） |
| 主机名 | `xpwFN`（Debian 系 / 内核 6.18.18 / x86_64 / 4 核 / 23 GB） |
| NAS 内网地址 | `192.168.31.13` |
| 部署目录 | `/home/xpw/ppcoffe` |
| 数据库 | 复用 NAS 上已有的 `mysql:8.4.1` 容器（宿主机映射端口 **3360**） |
| 对象存储 | NAS 上自建 MinIO（Alpine musl 运行时） |
| 守护方式 | systemd **user** 单元，开机自启 |

### 端口（frp 代理用）

| 端口 | 服务 | 说明 |
|---|---|---|
| **8081** | **H5 前端** | `http://192.168.31.13:8081/` ← **frp 代理这个** |
| **8080** | **API** | `http://192.168.31.13:8080/api/v1` ← **frp 代理这个** |
| **19000** | **MinIO S3** | 预签名直传入口 ← **frp 代理这个** |
| 19001 | MinIO 控制台 | 仅内网，建议走 SSH 隧道 |

> ⚠️ 三个都要代理。MinIO 的 19000 不能省 —— 前端直传图片走的是 S3 预签名 PUT。

---

## 1. 为什么不用 Docker

fnOS 预装 Docker（Compose v2.40.3），但存在三个硬约束：

| 约束 | 实测 | 影响 |
|---|---|---|
| **docker socket 权限** | `srw-rw---- root:docker`，`docker` 组只有 `trim.openclaw`；`xpw` 不在组内 | `docker ps` 报 `permission denied` |
| **sudo 需交互密码** | `sudo -n` 返回 `sudo: a password is required` | 技能规范禁止代填密码，无法自动提权 |
| **镜像源** | fnOS 自带 `daocloud` / `1ms.run` 可用（manifest 200）；但 `docker.fnnas.com` 返回 401、`ustc` / `hub.docker.com` 不可达 | 需改 `/etc/docker/daemon.json`（**需 root**） |

结论：Docker 路线**需要 root 改 daemon.json + 把 `xpw` 加入 docker 组**，属人工操作。
本方案改用 **fnOS 应用中心的原生运行时**，全程 `xpw` 权限即可完成。

> fnOS 应用中心自带 `python312`（`/usr/local/bin/python3.12` → Python 3.12.4）与
> `nodejs_v24`（v24.15.0），pip / venv / ensurepip 均可用，PyPI 走阿里云镜像正常。

---

## 2. 架构

```
   浏览器 / 微信小程序
            │
            ├── http://192.168.31.13:8081/ ──▶ serve_h5.py（标准库静态服务，644 KB 产物）
            │
            ├── http://192.168.31.13:8080/api/v1 ──▶ gunicorn(2w×2t) ──▶ Flask API
            │                                          │
            │                                          ├── MySQL 8.4（复用已有容器，:3360）
            │                                          ├── MinIO（自建，127.0.0.1:19000）
            │                                          └── Redis：未启用（自动降级，接口行为不变）
            │
            └── http://192.168.31.13:19000/ ──▶ MinIO S3 API（浏览器直传图片）
```

### 与阿里云 ECS 版的差异

| 组件 | 阿里云 ECS | fnOS NAS | 说明 |
|---|---|---|---|
| 部署方式 | Docker Compose | 原生进程 + systemd user | 避开 docker 权限限制 |
| 数据库 | MySQL 8.4（自建容器） | MySQL 8.4（**复用已有容器**） | 宿主机端口 3360 |
| 缓存 | Redis 7 | **不启用** | 后端已支持无 Redis 降级（`REDIS_URL` 留空） |
| 对象存储 | MinIO（Docker 镜像） | MinIO（**裸二进制 + musl**） | 见第 4 节 |
| 反向代理 | nginx 容器 | `serve_h5.py` 直出静态文件 | hash 路由，无需 rewrite |
| 内存占用 | 约 450 MB | 约 300 MB | NAS 上还跑着其他服务 |

---

## 3. 端口规划

fnOS 上 80 / 443 / 3000 / 3001 / 8000 / 9000 **已被系统与其他应用占用**，因此另开端口：

| 端口 | 服务 | 状态 |
|---|---|---|
| 8080 | ppCoffe API | 本次启用 |
| 8081 | ppCoffe H5 静态站点 | 本次启用 |
| 19000 | ppCoffe MinIO S3 | 本次启用（9000 被占） |
| 19001 | ppCoffe MinIO 控制台 | 本次启用 |
| 80 / 443 | fnOS Web 管理界面 | 系统占用，未动 |
| 3000 / 3001 / 8000 / 9000 | 其他应用 | 系统占用，未动 |

---

## 3.1 复用 NAS 上已有的 MySQL

fnOS 上本来就有 MySQL，**无需自建**：

| 项 | 值 |
|---|---|
| 容器名 | `/mysql` |
| 镜像 | `mysql:8.4.1` |
| root 密码 | 见 `backend/deploy/.env`（不入库） |
| **宿主机映射端口** | **3360**（不是 3306！） |

> ⚠️ **注意**：该容器没有把 3306 映射到宿主机，宿主机上监听的是 **3360**
> （`HostConfig.PortBindings`: `3306/tcp → 0.0.0.0:3360`）。
> 直连容器内网 `172.17.0.5:3306` 也可行，但走宿主机 3360 更稳。

部署时自动建库建账号：

```sql
CREATE DATABASE ppcoffe DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'ppcoffe'@'%' IDENTIFIED BY '<密码>';
GRANT ALL PRIVILEGES ON ppcoffe.* TO 'ppcoffe'@'%';
```

后端连接串：

```env
DATABASE_URL=mysql+pymysql://ppcoffe:<密码>@127.0.0.1:3360/ppcoffe?charset=utf8mb4
```

> **必须 utf8mb4**：风味描述里有「🍊」「🫘」等 emoji，utf8（3 字节）会直接报错。

---

## 3.2 在 glibc 上跑 MinIO（关键技巧）

### 障碍

MinIO 官方二进制（`dl.min.io`）已 **410 Gone**（开源版归档停维护），
GitHub Releases 不带二进制资产，国内镜像源也不收录。

而 **Alpine 社区源的 minio 包可以用**，但它是 **musl 动态链接**的：

```
$ file minio
ELF 64-bit LSB pie executable, x86-64, dynamically linked,
interpreter /lib/ld-musl-x86_64.so.1
```

fnOS 是 **glibc 2.36**（Debian 系），没有 `/lib/ld-musl-x86_64.so.1` → 直接跑会失败。

### 解法：带 musl loader 一起跑

从 Alpine 源下载三个包（`.apk` 就是 tar.gz，直接解包）：

```bash
https://mirrors.aliyun.com/alpine/v3.22/community/x86_64/minio-0.20250524.170830-r5.apk
https://mirrors.aliyun.com/alpine/v3.22/community/x86_64/minio-client-0.20250521.015954-r5.apk
https://mirrors.aliyun.com/alpine/v3.22/main/x86_64/musl-1.2.5-r13.apk
```

关键是**用 musl 的 loader 当解释器**：

```sh
#!/bin/sh
# minio-run.sh
exec /home/xpw/ppcoffe/minio-bin/muslpkg/lib/ld-musl-x86_64.so.1 \
     --library-path /home/xpw/ppcoffe/minio-bin/muslpkg/lib \
     /home/xpw/ppcoffe/minio-bin/apk/usr/bin/minio "$@"
```

> Alpine 的 mc 包把可执行文件装成 `mcli`（不是 `mc`），包装脚本里已处理。
> 阿里云版用的是同一批 Alpine 包自建 Docker 镜像 —— 思路一脉相承。

实测输出：

```
minio version RELEASE.2025-05-24T17-08-30Z (commit-id=0000000000000000000000000000000000000000)
Runtime: go1.24.12 linux/amd64
```

### 桶与账号初始化

复用 `backend/deploy/minio-policy.json`，与阿里云版一致：

* 三个桶：`ppcoffe-brew`（冲煮图）、`ppcoffe-roast`（烘焙原文件）、`ppcoffe-tmp`（直传中转）
* `ppcoffe-tmp` 加 30 天生命周期规则
* 应用账号 `ppcoffe` 只对这三个桶授权（**不用 root 凭据跑业务**）

---

## 4. 部署步骤

### 4.1 一键脚本

```bash
cd backend
bash deploy/deploy-fnos.sh fnos 192.168.31.13
```

脚本依次完成：同步代码 → 装依赖 → 上传并执行远端准备脚本（MinIO / MySQL / 配置 / systemd）→ 构建 H5 → 重启等待就绪。
**可重复执行**（幂等），已实测多次重跑正常。

> ⚠️ 本项目位于飞牛同步盘，**不保留可执行权限**（见根 README），
> 所以要用 `bash deploy/deploy-fnos.sh` 调用，不能直接 `./deploy/deploy-fnos.sh`。

> 远端逻辑放在 `deploy/fnos-remote-setup.sh` 里 —— 远程命令内嵌多层引号
> 会把 `if/fi` 拆坏（实测踩过），写成脚本文件由 NAS 自己解析最稳。

### 4.2 手工步骤（排查用）

```bash
# 1) 同步代码
COPYFILE_DISABLE=1 tar --exclude='.venv' --exclude='var' --exclude='__pycache__' \
    --exclude='.pytest_cache' --exclude='.env' --exclude='openapi.json' \
    --exclude='minio-bin' --exclude='._*' \
    -czf - -C backend . | ssh fnos "tar -xzf - -C /home/xpw/ppcoffe"

# 2) 依赖
ssh fnos "cd /home/xpw/ppcoffe && python3.12 -m venv .venv && \
    .venv/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ \
    --timeout 120 --retries 5 -r requirements.txt"

# 3) MinIO 运行时 + 二进制（见 3.2 节）
# 4) MySQL 建库建账号（见 3.1 节）
# 5) 生成 .env / .minio-env，建表 + seed
# 6) 构建 H5
cd <项目根>
TARO_APP_OUTPUT_ROOT=tmp/dist-fnos \
TARO_APP_API_BASE_URL=http://192.168.31.13:8080/api/v1 \
    npx taro build --type h5
tar -czf - -C tmp/dist-fnos . | ssh fnos "tar -xzf - -C /home/xpw/ppcoffe/web"

# 7) systemd 单元见第 5 节
```

### 4.3 NAS 侧环境配置

`/home/xpw/ppcoffe/.env`：

```env
APP_ENV=production
HOST=0.0.0.0
PORT=8080
PUBLIC_BASE_URL=http://192.168.31.13:8080
SECRET_KEY=<生产密钥>
JWT_SECRET=<生产密钥>
AUTH_MODE=dev
CORS_ORIGINS=*
SQLALCHEMY_ECHO=false
SQLALCHEMY_POOL_SIZE=10
SQLALCHEMY_POOL_RECYCLE=280

# MySQL 8（复用 fnOS 上已有的 mysql 容器，宿主机映射端口 3360）
DATABASE_URL=mysql+pymysql://ppcoffe:<密码>@127.0.0.1:3360/ppcoffe?charset=utf8mb4

# Redis 未启用（后端自动降级为实时计算）
REDIS_URL=

# 对象存储：NAS 上自建 MinIO
STORAGE_DRIVER=minio
MINIO_ENDPOINT=127.0.0.1:19000
MINIO_PUBLIC_ENDPOINT=192.168.31.13:19000
MINIO_ACCESS_KEY=ppcoffe
MINIO_SECRET_KEY=<应用密钥>
MINIO_SECURE=false
MINIO_REGION=us-east-1
MINIO_PUBLIC_BASE_URL=
MINIO_BUCKET_BREW=ppcoffe-brew
MINIO_BUCKET_ROAST=ppcoffe-roast
MINIO_BUCKET_TEMP=ppcoffe-tmp
MINIO_URL_TTL=604800
LOCAL_STORAGE_ROOT=/home/xpw/ppcoffe/var/uploads
```

> `AUTH_MODE` 当前为 `dev`（code 直接当 openid），便于联调。
> 小程序正式发布前需改为 `wechat` 并填 `WECHAT_APPID` / `WECHAT_SECRET`。

---

## 5. 开机自启（systemd user）

`xpw` 已启用 `Linger=yes`，因此 **systemd user 单元可在开机时随系统拉起**（无需 root）。

单元位于 `/home/xpw/.config/systemd/user/`：

| 单元 | 作用 | 关键项 |
|---|---|---|
| `ppcoffe-api.service` | Flask API | `GUNICORN_BIND=0.0.0.0:8080`，2 worker × 2 thread |
| `ppcoffe-minio.service` | MinIO S3 | `EnvironmentFile=.minio-env`，`:19000` / `:19001` |
| `ppcoffe-h5.service` | H5 静态站点 | `serve_h5.py --root …/web --port 8081` |

运维命令：

```bash
ssh fnos 'export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user status ppcoffe-api ppcoffe-minio ppcoffe-h5'
ssh fnos 'export XDG_RUNTIME_DIR=/run/user/1000; systemctl --user restart ppcoffe-api'
ssh fnos 'export XDG_RUNTIME_DIR=/run/user/1000; journalctl --user -u ppcoffe-minio -f'
```

> `XDG_RUNTIME_DIR=/run/user/1000` 必须在 SSH 远程会话里显式设置，
> 否则 `systemctl --user` 找不到用户总线。

---

## 6. 前端托管说明

`backend/deploy/serve_h5.py` 是**零依赖**静态服务器（仅 Python 标准库），
之所以不用 nginx：

* Taro H5 默认使用 **hash 路由**（`location.hash`），路径不带在服务端，
  因此**不需要 SPA fallback 的 rewrite 规则**
* 产物仅 644 KB，单文件请求量小，标准库足够

它实现了：正确的 `Content-Type`（`.js`/`.css` 必须正确，否则浏览器拒绝执行脚本）、
ETag / `Last-Modified` 条件请求、HTML 不缓存 + 静态资源长缓存、目录穿越防护。

---

## 7. 验收结果

在 fnOS 上实测（2026-11-24）：

| 检查项 | 结果 |
|---|---|
| API 健康检查 | ✅ `{"ok":true,"status":"ok","database":"ok","storage":"minio"}` |
| MySQL 建表 + 数据 | ✅ beans 3 / brews 4 / roasts 1 / equipment 8 |
| H5 首页 | ✅ 200，`text/html` |
| H5 JS / CSS 资源 | ✅ 200，MIME 正确 |
| 登录 `POST /api/v1/auth/wechat` | ✅ 签发 JWT（access + refresh） |
| MinIO 预签名 `POST /api/v1/uploads/presign` | ✅ 返回带 SigV4 签名的 uploadUrl |
| **预签名直传 PUT** | ✅ **200**，对象成功落桶 |
| MinIO 健康检查 / 控制台 | ✅ 200 / 200 |
| 元数据 `GET /api/v1/methods` | ✅ 返回 11 条冲煮方式 |
| CORS 预检 | ✅ 回显前端来源 `Access-Control-Allow-Origin` |
| systemd 三个单元 | ✅ `active` + `enabled` |
| 部署脚本幂等重跑 | ✅ 服务正常 |
| 演示数据量 | ✅ 与阿里云端一致 |

---

## 8. ⚠️ frp 代理的关键约束：SigV4 签名

**走 frp 对外暴露时，有两个地址必须同时改成对外地址。**

原因：SigV4 把 `Host` 计入签名。浏览器发出的 `Host:` 头必须与签名时算入的完全一致，
否则直传会报 **403 SignatureDoesNotMatch**。

| 配置项 | 当前值 | 走 frp 后必须改成 |
|---|---|---|
| 前端产物里的 `TARO_APP_API_BASE_URL` | `http://192.168.31.13:8080/api/v1` | `http://<对外地址>:<对外端口>/api/v1` |
| `.env` 里的 `MINIO_PUBLIC_ENDPOINT` | `192.168.31.13:19000` | `<对外地址>:<对外端口>` |

### 最省事的做法

用对外地址作为脚本参数重跑，它会同时改这两处并重建前端：

```bash
cd backend
bash deploy/deploy-fnos.sh fnos <对外地址>
```

### frp 配置参考

```
# 在 frpc 端配置三个 TCP 代理
[ppcoffe-h5]
type = tcp
local_ip = 192.168.31.13
local_port = 8081
remote_port = <对外端口>

[ppcoffe-api]
type = tcp
local_ip = 192.168.31.13
local_port = 8080
remote_port = <对外端口>

[ppcoffe-minio]
type = tcp
local_ip = 192.168.31.13
local_port = 19000
remote_port = <对外端口>
```

> ⚠️ **三个都要代理**，MinIO 的 19000 不能省 —— 前端直传图片走的是 S3 预签名 PUT。

### 如果三个服务要共用同一个对外端口

那就需要一层 nginx 做 path 转发，但 **S3 路径不能改写** ——
改写会破坏 SigV4 的 canonical URI，导致签名失效。此时应当：
给 S3 单独分配一个对外端口（推荐），或让 frp 为 MinIO 单独开端口。

### 小程序上线的额外要求

微信小程序正式发布还要求：

* **HTTPS + 已在微信后台配置的合法域名**（IP + HTTP 只能在开发者工具「不校验合法域名」下用）
* `AUTH_MODE` 改为 `wechat`，填入 `WECHAT_APPID` / `WECHAT_SECRET`
* 家用宽带通常**没有备案域名**，正式发布小程序一般仍需一台有备案域名的云主机
  （阿里云 ECS 那套可继续承担该角色）

---

## 9. 排查备忘

| 现象 | 原因 / 处理 |
|---|---|
| `docker ps` 报 permission denied | `xpw` 不在 `docker` 组且 sudo 需密码；本方案已绕开 Docker |
| MySQL 连不上 3306 | 该容器宿主机映射的是 **3360**，不是 3306 |
| MinIO 报 `cannot execute: required file not found` | 缺 musl loader；用 `minio-run.sh` 包装脚本启动，别直接跑二进制 |
| `mc` 命令找不到 | Alpine 包里叫 `mcli`，包装脚本已处理 |
| `systemctl --user` 报错找不到总线 | 远程会话需 `export XDG_RUNTIME_DIR=/run/user/1000` |
| systemd 服务 `activating` 卡住、端口未释放 | 手工起的旧进程仍占端口；先停旧进程再 `restart` |
| 直传报 403 SignatureDoesNotMatch | 签名端点与浏览器实际访问的 host 不一致（见第 8 节） |
| 预签名 PUT 返回 000 | 请求发往的地址与签名 host 不匹配，或该端口没代理 |
| API 有数据但前端列表为空 | `ensure_owner` 做用户级隔离，演示数据 `user_id=NULL` 归属「无主」（阿里云版行为一致） |
| `pip install` 极慢 | 用 `-i https://mirrors.aliyun.com/pypi/simple/` |
| `tar: Ignoring unknown extended header keyword` | macOS 扩展属性，无害；可加 `COPYFILE_DISABLE=1` |
| 前端请求 404 且页面空白 | 确认构建时 `TARO_APP_API_BASE_URL` 指向的是**浏览器可达**的地址 |
| 公网能连 TCP 但 HTTP 无响应 | 路由器未做端口转发（见第 8 节） |
