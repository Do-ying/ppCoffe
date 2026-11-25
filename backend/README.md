# ppCoffe · 后端

> 冲煮 + 烘焙双链路咖啡记录工具的后端服务。
> 技术栈：**Flask 3 · SQLAlchemy 2 · MySQL 8 · Redis 7（可选）· MinIO（对象存储）**
>
> 接口契约：`docs/02-接口契约.md`　部署方案：`docs/03-后端部署方案.md`

---

## 快速开始

```bash
cd backend

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp .env.example .env          # 按需修改 DATABASE_URL / SECRET_KEY 等
.venv/bin/python manage.py init-db     # 建表
.venv/bin/python manage.py seed        # 灌入演示数据（可选）
.venv/bin/python manage.py run        # http://127.0.0.1:8000/api/v1
```

本机没有 MySQL 时，可以先用 SQLite 把链路跑通：

```env
DATABASE_URL=sqlite:////绝对路径/backend/var/ppcoffe.db
```

> MySQL 与 SQLite 共用同一套 ORM 模型与 SQL，切换只改连接串。
> 但 **SQLite 的相对路径会被 Flask-SQLAlchemy 解析到 instance 目录**，所以本地请用绝对路径。

一键起齐完整依赖栈（MySQL + Redis + MinIO + API）：

```bash
docker compose up -d --build
docker compose exec api python manage.py init-db
```

---

## 目录结构

```
backend/
├── app/
│   ├── __init__.py          # create_app 应用工厂
│   ├── config.py            # 配置（环境变量 > .env > 默认值）
│   ├── extensions.py        # SQLAlchemy / Redis 单例
│   ├── errors.py            # 错误码与业务异常
│   ├── envelope.py          # 统一响应包络 {ok, data, meta}
│   ├── ids.py               # ULID 风格 ID 生成
│   ├── security.py          # JWT 签发/校验、登录态
│   ├── schemas.py           # marshmallow 请求校验
│   ├── openapi.py           # OpenAPI 3.1 文档生成
│   ├── domain/              # ★ 与前端 src/domain/ 一一对应的纯算法
│   │   ├── compat.py        #   JS 数值语义兼容（toFixed / Math.round / parseFloat）
│   │   ├── interpolate.py   #   单调三次样条（Fritsch-Carlson）
│   │   ├── curve.py         #   冲煮曲线生成（plan / keypoint / device）
│   │   ├── roast.py         #   烘焙指标（RoR / DTR / 阶段占比 / .alog 解析）
│   │   ├── flavor.py        #   风味轮与吻合度
│   │   ├── methods.py       #   冲煮方式元数据与参数校验
│   │   └── diagnosis.py     #   风味偏差诊断与处方
│   ├── models/              # ORM 模型
│   ├── api/                 # 蓝图（auth / beans / brews / roasts / ...）
│   ├── services/            # 缓存（Redis）与对象存储（MinIO / 本地）
│   └── seed/                # 元数据 JSON + 演示数据
├── tests/                   # pytest（跨语言一致性 + API 集成）
├── docs 契约参考             # ../docs/
├── docker-compose.yml       # MySQL + Redis + MinIO + API
├── Dockerfile
├── gunicorn.conf.py
├── manage.py                # init-db / seed / run / export-openapi
└── openapi.json             # 导出的 OpenAPI 3.1 文档
```

---

## 核心设计

### 1. 统一响应包络

```jsonc
// 成功
{ "ok": true, "data": { }, "meta": { "requestId": "req_01M..." } }

// 失败
{ "ok": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "field": "doseGrams" },
  "meta": { "requestId": "req_01M..." } }
```

错误码：`INVALID_PARAM(400)` `VALIDATION_FAILED(422)` `UNAUTHORIZED(401)` `FORBIDDEN(403)`
`NOT_FOUND(404)` `CONFLICT(409)` `RATE_LIMITED(429)` `INTERNAL(500)`

### 2. 算法与前端逐值一致 ★

前端 `src/domain/` 是这套算法（曲线生成、风味诊断、烘焙指标）的第一实现，
后端移植了一份，并通过**跨语言基准比对**保证数值完全一致：

```bash
# 1. 从前端 TS 导出基准输出
npm run dump:parity          # → backend/tests/fixtures/parity_expected.json

# 2. 跑 Python 侧比对
cd backend && .venv/bin/python -m pytest tests/test_domain_parity.py -v
```

比对覆盖：11 种方式的理论曲线、关键点曲线、设备采集曲线、瞬时流速、
烘焙 RoR / DTR / 阶段占比 / RoR 形态异常、Artisan `.alog` 解析、
6 组风味诊断、吻合度计算。

> 关键细节：JS 的 `Number(x.toFixed(n))` 是「基于精确二进制值的逢五进位」，
> 与 Python 内置 `round()`（银行家舍入）在 `.5` 边界上结果不同。
> `app/domain/compat.py` 补齐了这三处语义（`toFixed` / `Math.round` / `parseFloat`）。

### 3. 元数据由后端下发

`GET /methods`（11 种方式 + 参数区间 + 风味基线 + 默认注水计划）与
`GET /flavor-wheel`（SCA 风味轮）由后端下发，前端启动时拉取并缓存，
调参不需要发版。

元数据 JSON 由前端源导出，避免两边维护两份：

```bash
npm run dump:metadata        # → backend/app/seed/methods.json + flavor_wheel.json
```

### 4. 曲线独立成表

`brew_curves` / `roast_curves` 独立存曲线点（JSON 列），
主表只放摘要字段——列表接口不碰大 JSON，查询更快、备份更小。

### 5. 对象存储可插拔

前端不绑定任何存储实现，只消费后端下发的 `objectKey` / `uploadUrl` / `publicUrl`：

* `STORAGE_DRIVER=minio` —— 生产，预签名 PUT 直传，图片流量不经过 API
* `STORAGE_DRIVER=local` —— 本地兜底，写 `backend/var/uploads/`，直传链路照样跑通

### 6. Redis 可选

未配置或连不上时自动降级为无缓存，接口行为不变。
`/methods`、`/flavor-wheel` 强缓存；`/stats/summary` 快照（写入后主动失效）。

---

## 接口一览（33 个路径）

| 域 | 端点 |
|---|---|
| 认证 | `POST /auth/wechat`、`POST /auth/refresh`、`GET /auth/me` |
| 豆子 | `GET/POST /beans`、`GET/PATCH/DELETE /beans/{id}`、`GET /beans/{id}/brews`、`GET /beans/{id}/roasts`、`GET /beans/{id}/trend` |
| 冲煮 | `GET/POST /brews`、`GET/PATCH/DELETE /brews/{id}`、`POST /brews/{id}/curve`、★`POST /brews/derive-curve`、★`POST /brews/compare`、★`GET /brews/{id}/diagnosis` |
| 烘豆 | `GET/POST /roasts`、`GET/PATCH/DELETE /roasts/{id}`、`POST /roasts/{id}/events`、`POST /roasts/import`、`POST /roasts/compare` |
| 配方 | `GET/POST /recipes`、`GET/PATCH/DELETE /recipes/{id}` |
| 器具 | `GET/POST /equipment`、`GET/PATCH/DELETE /equipment/{id}` |
| 元数据 | `GET /methods`、`GET /flavor-wheel`、`GET /roast-phases` |
| 统计 | `GET /stats/summary`、`GET /stats/trends` |
| 上传 | `POST /uploads/presign`、`POST /uploads`、`DELETE /uploads` |
| 数据 | `GET /export`、`POST /import` |
| 系统 | `GET /health`、`GET /openapi.json` |

★ = 核心差异化端点。

完整机器可读定义：

```bash
.venv/bin/python manage.py export-openapi     # → backend/openapi.json
curl http://127.0.0.1:8000/api/v1/openapi.json
```

前端可直接生成类型：

```bash
npx openapi-typescript http://127.0.0.1:8000/api/v1/openapi.json -o src/types/api.d.ts
```

---

## 测试

```bash
cd backend
.venv/bin/python -m pytest tests/ -v
```

| 文件 | 覆盖 |
|---|---|
| `tests/test_domain_parity.py` | 与前端 TS 的逐值一致性（28 项） |
| `tests/test_api.py` | 接口集成：包络、错误码、游标分页、CRUD、诊断、对比、导入导出、上传（30 项） |

---

## 配置速查

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | MySQL 本地 | SQLAlchemy 连接串 |
| `AUTH_MODE` | `dev` | `wechat` / `dev` / `none` |
| `SECRET_KEY` / `JWT_SECRET` | 开发默认值 | **生产必须覆盖**（≥32 字节） |
| `REDIS_URL` | 空 | 留空 = 无缓存 |
| `STORAGE_DRIVER` | `local` | `minio` / `local` |
| `MINIO_*` | 见 `.env.example` | 端点、密钥、桶名 |
| `PUBLIC_BASE_URL` | 空 | 预签名直传地址需要绝对 URL |

---

## 与前端对接

```env
# 前端 .env.development
TARO_APP_API_MODE=real
TARO_APP_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

`TARO_APP_API_MODE=mock` 走前端内置 Mock 层，`real` 走本服务。
两者接口签名完全一致（见前端 `src/services/http.ts`）。
