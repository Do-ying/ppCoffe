# ppCoffe

> 冲煮与烘焙双链路咖啡记录工具。用**风味**做中枢，把冲煮参数、冲煮曲线、烘焙曲线三者的因果关系显式化。

```
烘焙曲线 → 豆子状态 → 冲煮参数 → 冲煮曲线 → 风味表现 → 反推下一杯怎么改
```

---

## 技术栈

| 项 | 选型 |
|---|---|
| 框架 | Taro 4.3 + React 18 + TypeScript 5 |
| 编译器 | Vite |
| 状态 | Zustand（草稿）+ TanStack Query（服务端状态） |
| 图表 | 自研 Canvas 2D 渲染层（零依赖，可控） |
| 样式 | Sass + CSS Variables Design Token |
| 端 | 微信小程序 + H5（同一套代码） |
| 接口 | REST + JSON，Mock / Real 双传输层可切换 |

## 快速开始

```bash
npm install

# 微信小程序
npm run dev:weapp      # 产物在 dist/，用微信开发者工具打开项目根目录
npm run build:weapp

# H5
npm run dev:h5          # http://localhost:10086
npm run build:h5

# 质量门禁
npm run typecheck       # TypeScript 类型检查
npm run selftest        # domain 层自检（20 项断言）
```

> **注意 1 · 同步盘权限**：本项目位于飞牛同步目录，该目录**不保留可执行权限**，
> 同步过程中会把二进制文件的执行位抹成 `600`，导致 `node_modules/.bin/*` 全部 `Permission denied`。
> 根治做法是把 `node_modules` 移出同步盘、用软链接接回（本项目已这样处理）：
> ```bash
> mv node_modules ~/.local/ppcoffe/node_modules
> ln -s ~/.local/ppcoffe/node_modules node_modules
> chmod -R u+rwX,go+rX ~/.local/ppcoffe/node_modules
> ```
> 若 `npm run xxx` 仍报权限错误，先执行上面的 `chmod`。

> **注意 2 · 产物目录分离**：小程序端产物在 `dist/`，H5 端在 `dist-h5/`（通过
> `TARO_APP_OUTPUT_ROOT` 隔离），避免两端构建互相覆盖。

## Canvas 跨端渲染（踩坑记录）

曲线图与雷达图是自研 Canvas 渲染层（零依赖）。H5 端有三个坑，已在
`src/platform/chartContext.ts` 中统一处理：

| 坑 | 现象 | 处理 |
|---|---|---|
| `canvas-id` 挂在包装元素上 | `createCanvasContext` 查不到节点，静默失效、画布全白 | H5 端改用原生 `CanvasRenderingContext2D`，小程序端沿用 Taro 旧版 API，绘图代码零分支 |
| `setFontSize` 依赖已设置的字体族 | 抛 `Cannot read properties of undefined (reading 'split')` | 封装层统一处理字体设置 |
| Canvas 组件每次渲染重设 `canvas.width/height` | 重渲染后画布被清空变白 | 每次渲染后重绘（取不到上下文时按帧重试） |

另外 `useReady` 在**子组件**中不会触发，图表组件不能依赖它，改用挂载后自行重试。


## 目录结构

```
src/
├── app.tsx / app.config.ts     # 应用入口与路由（3 Tab + 14 页）
├── domain/                     # ★ 纯领域层：无 UI、无平台依赖、可单测
│   ├── types.ts                #   领域类型
│   ├── methods.ts              #   11 种冲煮方式元数据（参数区间 + 风味基线）
│   ├── flavor.ts               #   SCA 风味轮 + 六轴定义
│   ├── curve/
│   │   ├── interpolate.ts      #   单调三次样条（Fritsch-Carlson）
│   │   ├── generate.ts         #   plan / keypoint / device 三种曲线生成
│   │   └── roast.ts            #   RoR、DTR、阶段占比、.alog 解析
│   └── diagnosis/index.ts      #   ★ 风味偏差诊断引擎
├── services/
│   ├── http.ts                 #   HttpClient + Transport 抽象
│   └── index.ts                #   语义化 API（一个端点一个函数）
├── mock/db.ts                  #   内存 Mock 数据库 + Mock Transport
├── store/                      #   Zustand：冲煮草稿 + 主题
├── platform/                   #   Canvas 上下文、图片选择等跨端适配
├── components/chart/           #   CurveChart / RoastCurveChart / FlavorRadar
├── styles/                     #   tokens.scss / themes.scss / colors.ts / parts.scss
└── pages/
    ├── home/                   #   首页（统计 / 快速记录 / 工具入口 / 养豆状态）
    ├── brew/                   #   列表 / 选方式 / 参数 / 风味 / 详情
    ├── bean/                   #   豆仓列表 / 豆子详情 / 豆子编辑
    ├── roast/edit/             #   添加烘焙批次（事件打点）
    ├── curve/                  #   曲线分析（按豆子维度）
    ├── equipment/              #   器具列表 / 器具编辑
    └── settings/               #   外观 + 版本号
```

## 信息架构

底部 3 个 Tab：**首页 · 记录 · 豆仓**。

**曲线不独立成 Tab**，而是归属到豆仓里的具体豆子——豆仓是整个 App 的中枢：

```
豆仓（豆子） → 豆子详情
                 ├─ 档案（产地 / 处理法 / 养豆状态 / 剩余）
                 ├─ 曲线入口（冲煮曲线 N 条 / 烘焙曲线 N 条）
                 │     └─ 曲线页 ?beanId=xxx  → 分「冲煮曲线 / 烘焙曲线」两段
                 ├─ 冲煮记录（+ 冲煮 → 选方式 → 参数 → 风味）
                 └─ 烘焙批次（+ 烘焙 → 事件打点 → 合成曲线）
```

豆仓默认为空，需要手动添加豆子；曲线也默认为空，添加冲煮记录或烘焙批次后才会生成。

**分层铁律**：`domain/` 是纯函数层 → `services/` 只做 HTTP → `pages/` 只做编排。
曲线算法、风味诊断、RoR 计算全部落在 `domain/`，后端用 Python 重写时可逐条对照验收。

## 主题

设置页提供三种外观：**深色**（炭墨底 + 仪表荧光青）、**浅色**（冷灰白纸感 + 深墨字）、**跟随系统**。

- 颜色全部落在 CSS 变量里（`src/styles/themes.scss`），切换只换变量值，不重渲染任何业务组件
- H5 端主题挂在 `<html data-theme>`，小程序端挂在页面根节点 class + `setBackgroundColor`
- 原生 TabBar 不吃 CSS 变量，通过 `Taro.setTabBarStyle` 同步配色
- Canvas 图表读不到 CSS 变量，`src/styles/colors.ts` 维护与主题对应的调色板，运行时按主题取用

## 核心能力

### 1. 冲煮方式 ↔ 风味联动（双向）

- **正向**：选「意式浓缩」→ 参数表单切为意式专属形态（粉量/液重/时间/压力档），粉液比自动计算并按 1:2 校验，水温提示 90–94℃，风味词库只开放适合意式的子类，雷达图预画该方式的目标风味基线
- **反向**：打完风味分 → 对比基线 → 输出偏差与处方
  - 尖酸 + 缺甜 + 余韵短 → **萃取不足** → 磨细 / 粉量↑ / 水温↑ / 延时 / 加强搅拌
  - 醇厚过高 + 平衡与余韵偏低 → **萃取过度** → 磨粗 / 延时- / 水温↓
  - 酸甜同时偏高但平衡低 → **萃取不均** → 改善搅拌 / 检查细粉与豆子新鲜度
  - 全部低于基线 → **风味平淡** → 提高粉水比

11 种方式：手冲 V60 / Kalita / Origami、Chemex、法压壶、虹吸壶、摩卡壶、意式浓缩、爱乐压、气压壶、冷萃。

### 2. 曲线生成（三种来源统一抽象）

| 模式 | 说明 |
|---|---|
| `plan` | 由分段注水计划生成理论曲线（单调三次样条平滑 + 阶段色带） |
| `keypoint` | 计时中打 3–6 个关键点，插值补全 |
| `device` | 蓝牙秤 / CSV 采集序列清洗 + 瞬时流速计算 |

### 3. 烘焙曲线分析

RoR（30s 中心窗口，对齐 Artisan）、DTR 发展比、脱水/梅纳/发展三阶段占比、失重率、RoR 形态健康检查（crash / flick / 一爆前热量不足）、Artisan `.alog` 导入。

曲线分析页分「冲煮曲线 / 烘焙曲线」两段。烘焙侧为 **BT / ET / RoR 三通道**绘制，叠加阶段色带与事件标记（投豆 / 回温点 / 脱水结束 / 一爆 / 下豆）。

### 4. 器具与研磨度

器具按类型管理（磨豆机 / 滤杯 / 冲煮器具 / 咖啡机 / 电子秤 / 烘豆机），冲煮记录可关联多件器具。

**磨豆机的刻度基准**（如「#22 约 0.8mm」）是研磨度记录的前提——刻度只在具体某台机器上有意义，所以研磨度输入会随所选磨豆机给出基准参考。

### 5. 图片备注与评鉴内容

- **评鉴内容**：`BrewRecord.review`（长文本），与 `flavor.note`（短风味备注）并存
- **图片备注**：`BrewRecord.images[]`，选图 → 上传 → 关联到冲煮记录
- **存储由后端决定**：前端只调用 `POST /uploads/presign` 拿 `{objectKey, uploadUrl, publicUrl, headers}` 后直传，不绑定任何对象存储实现（MinIO / S3 / OSS 均可），详见 `docs/02-接口契约.md` 第 5.5 节

## 接入真实后端

后端已在 `backend/` 落地（Flask，`create_app` 工厂，10 个蓝图覆盖契约全部端点）。

1. 启动后端（`backend/`）
2. 改 `.env.development` / `.env.production`：
   ```bash
   TARO_APP_API_MODE=real
   TARO_APP_API_BASE_URL=http://127.0.0.1:<port>/api/v1
   ```
3. 重启构建。`src/services/http.ts` 的 `realTransport` 会接管，页面代码无需改动。

> ⚠️ real 模式当前有两处前端侧未打通：
> - **无登录流程** —— `http.ts` 已能读写 token（`ppcoffe.token`），但没有 `wx.login` → `POST /auth/wechat` 的接入，请求不会带 `Authorization`。
> - **冲煮记录未落库** —— `api.createBrew` / `updateBrew` 目前零引用，详情页没有保存按钮。
>
> 两处的修复方向见 [`docs/03-前端实现文档.md`](docs/03-前端实现文档.md) §12。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/00-产品与页面规划.md` | 调研结论、领域模型、方式×风味联动、曲线生成规则、30 页清单与落地对照、阶段规划 |
| `docs/01-前端技术方案.md` | 四套选型对比与推荐、工程架构、设计方向、质量门禁（**已按落地实况纠偏**） |
| `docs/02-接口契约.md` | 40+ 端点、完整数据模型 JSON、Mock 策略、后端实现建议（**已补前端端点映射**） |
| `docs/03-前端实现文档.md` | **代码实况**：分层架构、领域算法口径、14 页逐页规格、组件契约、设计令牌、差异台账与缺口清单 |
| `docs/03-后端部署方案.md` | 后端架构、MySQL/Redis/MinIO 选型、阿里云 ECS 部署记录与踩坑 |
| `docs/04-fnOS部署记录.md` | fnOS NAS 部署（无 Docker 备选方案：原生进程 + systemd user） |
| `docs/05-fnOS部署记录-Docker版.md` | **fnOS NAS 部署（主方案）**：全栈 Docker 化、镜像策略、frp 配置 |

## 当前进度

- [x] **P0** 脚手架、设计令牌、双主题、路由、API 层、Mock 层、状态层
- [x] **P1** 豆仓 CRUD + 冲煮记录（参数 / 器具 / 研磨度 / 风味 / 评鉴 / 图片）、风味诊断
      —— ⚠️ **尾差**：冲煮详情页无保存按钮，`api.createBrew` 零引用，记录**尚无法落库**
- [x] **P2** 冲煮曲线生成与绘制、曲线分析页、风味雷达与偏差可视化
      —— `keypoint` / `device` 两种来源算法已实现，缺页面入口
- [x] **P4** 烘豆模块（事件打点合成曲线、BT/ET/RoR 三通道、叠加对比、.alog 解析）
      —— ⚠️ **尾差**：`.alog` 解析已实现，缺导入 UI；实时记录未做
- [ ] **P3** 实时计时器 + 分段注水引导 + 蓝牙秤接入
- [ ] **P5** 趋势洞察、分享卡片、烘焙批次导入 UI
- [ ] **P6** 生豆库存、配方市场、端侧冲煮建议

> 完整的差距台账与修复优先级见 [`docs/03-前端实现文档.md`](docs/03-前端实现文档.md) §11–§12。

MIT License
