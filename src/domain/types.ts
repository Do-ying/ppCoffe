/**
 * ppCoffe 领域类型定义
 * 这一层是纯 TypeScript，不依赖 Taro / React / 任何平台 API，
 * 保证 domain 逻辑可被后端逐条对照验收，也可在 Node 环境下单测。
 */

/** 冲煮方式分类：重力渗透 / 浸泡 / 压力 / 冷萃 */
export type MethodCategory = 'percolation' | 'immersion' | 'pressure' | 'cold'

/** 曲线阶段 */
export type CurveStage = 'preinfusion' | 'bloom' | 'extraction' | 'drawdown'

/** 曲线数据来源 */
export type CurveSource = 'plan' | 'keypoint' | 'device' | 'import' | 'live'

/** 品饮温度段 */
export type TempStage = 'hot' | 'warm' | 'cool'

/** 风味记录深度档位 */
export type FlavorDepth = 'quick' | 'standard' | 'cupping'

/** 参数字段规格 */
export interface ParamSpec {
  key: string
  label: string
  required: boolean
  /** 建议默认值 */
  default?: number
  /** 目标值（用于粉液比这类有明确最优解的字段） */
  target?: number
  /** 允许区间，闭区间 */
  range?: [number, number]
  unit?: 'g' | 'ml' | 's' | '°C' | 'bar'
  /** 输入提示 */
  hint?: string
  /** 是否为派生字段（由其它字段计算，不直接输入） */
  derived?: boolean
}

/** 六轴风味画像（对齐 SCA 核心属性 + 消费级简化六轴） */
export interface FlavorAxes {
  /** 酸质 acidity（正面明亮，不等于欠萃的酸涩） */
  acidity: number
  /** 甜感 sweetness */
  sweetness: number
  /** 醇厚 body */
  body: number
  /** 风味 flavor */
  flavor: number
  /** 余韵 aftertaste */
  aftertaste: number
  /** 平衡 balance */
  balance: number
}

export const FLAVOR_AXIS_KEYS: (keyof FlavorAxes)[] = [
  'acidity',
  'sweetness',
  'body',
  'flavor',
  'aftertaste',
  'balance'
]

export const FLAVOR_AXIS_LABELS: Record<keyof FlavorAxes, string> = {
  acidity: '酸质',
  sweetness: '甜感',
  body: '醇厚',
  flavor: '风味',
  aftertaste: '余韵',
  balance: '平衡'
}

/** 注水/萃取分段 */
export interface BrewStep {
  /** 到达该时刻的秒数 */
  atSecond: number
  /** 目标累计重量（克） */
  toGrams: number
  label: string
  stage: CurveStage
}

/** 冲煮方式元数据：方式联动风味的唯一数据源 */
export interface BrewMethod {
  id: string
  name: string
  aliases: string[]
  category: MethodCategory
  /** 一句话原理描述 */
  summary: string
  params: Record<string, ParamSpec>
  /** 研磨度提示 */
  grindHint: string
  /** 该方式的目标风味基线，雷达图基准轮廓 */
  flavorBaseline: FlavorAxes
  /** 推荐风味词库子类 */
  flavorCategories: string[]
  /** 浓度参考区间 TDS % */
  tdsRange: [number, number]
  /** 萃取率参考区间 % */
  extractionRange: [number, number]
  /** 该方式下的常见变体 */
  brewStyles: string[]
  /** 默认注水计划，用于生成理论曲线 */
  defaultSteps: BrewStep[]
}

/** 风味轮描述词 */
export interface FlavorDescriptor {
  id: string
  label: string
  category: string
  /** 强度 0-10 */
  intensity: number
  tempStage: TempStage
}

export interface FlavorDefect {
  id: string
  label: string
  /** 1=轻微 2=明显 3=严重 */
  severity: number
}

/** 风味记录 */
export interface FlavorProfile {
  axes: FlavorAxes
  descriptors: FlavorDescriptor[]
  defects: FlavorDefect[]
  tempStage: TempStage
  /** 整体印象 0-10 */
  overall: number
  note: string
}

/** 冲煮参数 */
export interface BrewParams {
  doseGrams: number
  waterGrams: number
  yieldGrams: number
  brewSeconds: number
  temperature: number
  /** 研磨度刻度（相对所选磨豆机） */
  grindSetting?: string
  /** 研磨度数值（部分磨豆机支持刻度换算） */
  grindValue?: number
  preinfusionSeconds?: number
  /** 粉液比，由 doseGrams / waterGrams 派生 */
  ratio?: number
}

/** 曲线点 */
export interface CurvePoint {
  /** 秒 */
  t: number
  /** 累计重量（克） */
  w: number
  /** 瞬时流速（克/秒） */
  flow: number
  stage: CurveStage
}

/** 曲线阶段区间 */
export interface CurveStageSpan {
  from: number
  to: number
  label: string
  stage: CurveStage
}

/** 冲煮曲线 */
export interface BrewCurve {
  source: CurveSource
  points: CurvePoint[]
  stages: CurveStageSpan[]
}

/** 冲煮记录附图（存于 MinIO 对象存储） */
export interface BrewImage {
  id: string
  /** MinIO 对象键，例如 brew/br_xxx/uuid.jpg */
  objectKey: string
  /** 可访问 URL（后端下发，公开读或签名读） */
  url: string
  /** 图片说明 */
  caption?: string
  width?: number
  height?: number
  sizeBytes?: number
}

/** 冲煮记录 */
export interface BrewRecord {
  id: string
  beanId: string
  roastBatchId?: string
  method: string
  /** 使用的器具 id（冲煮器具 / 磨豆机 / 秤） */
  equipmentIds?: string[]
  params: BrewParams
  steps: BrewStep[]
  curve: BrewCurve
  flavor: FlavorProfile
  /** 风味短备注 */
  notes: string
  /** 评鉴内容（长文本，可多段） */
  review?: string
  /** 附图 */
  images?: BrewImage[]
  /** ISO 时间 */
  brewDate: string
  createdAt: string
  updatedAt: string
}

/**
 * 豆子类型
 *
 * - `purchased_roasted` 成品豆：购入即可冲煮，烘焙度与烘焙日期在豆子这一层
 * - `green` 生豆：按购入批次登记库存，可分多炉烘焙，每炉单独记录
 * - `undefined` 待确认类型：旧数据迁移后的初始状态，确认前可查看历史
 */
export type BeanKind = 'purchased_roasted' | 'green'

export const ROAST_LEVEL_LABELS = {
  light: '浅焙',
  medium: '中焙',
  medium_dark: '中深焙',
  dark: '深焙'
} as const

/** 养豆阶段（按自然日口径，与后端 app/domain/rest.py 一致） */
export type RestStage = 'resting' | 'peak' | 'fading' | 'unknown'

export interface RestStageInfo {
  stage: RestStage
  label: string
  /** 距烘焙日期的天数；烘焙日期未知时为 undefined */
  days?: number
  roastDate?: string
}

/** 养豆事件类型 */
export type RestEventType = 'opened' | 'sealed' | 'divided' | 'note'

/** 养豆事件 */
export interface RestEvent {
  id: string
  beanId: string
  /** 生豆事件挂在具体炉次；成品豆为 undefined（挂在购入批次上） */
  roastBatchId?: string
  type: RestEventType
  /** ISO 时间 */
  occurredAt: string
  note?: string
  createdAt: string
  updatedAt: string
}

/** 咖啡豆批次 */
export interface Bean {
  id: string
  name: string
  roaster: string
  origin: {
    country: string
    region?: string
    farm?: string
    altitudeMasl?: number
    variety?: string
  }
  process: 'washed' | 'natural' | 'honey' | 'anaerobic' | 'other'
  roastLevel: 'light' | 'medium' | 'medium_dark' | 'dark' | null
  agtron?: number
  /** ISO date */
  roastDate: string | null
  weightGrams: number
  /** 剩余克数：生豆按炉次汇总计算，成品豆为录入值；库存待核对时为 undefined */
  remainingGrams: number | null | undefined
  tags: string[]
  imageUrl?: string | null
  notes?: string
  /** 豆子类型：成品豆 / 生豆；undefined 表示旧数据待确认类型 */
  kind?: BeanKind | null
  /** 实付豆款（分）；undefined 表示未填写采购价，0 表示明确填了 0 元 */
  purchaseCostCents?: number | null
  /** 封面图对象键（对象存储） */
  sourceFileKey?: string | null
  /** 生豆已用克数（按炉次汇总）；undefined 表示库存待核对 */
  usedGreenGrams?: number | null
  /** 库存是否待核对（历史投豆克数缺失） */
  stockPending?: boolean
  /** 每克成本（元/克）；undefined 表示未填写采购价 */
  costPerGram?: number | null
  /** 养豆阶段信息 */
  restStage?: RestStageInfo
  createdAt: string
  updatedAt: string
}

/** 烘焙事件类型 */
export type RoastEventType =
  | 'charge'
  | 'turningPoint'
  | 'dryEnd'
  | 'firstCrack'
  | 'drop'

export interface RoastEvent {
  type: RoastEventType
  atSecond: number
  temperature: number
}

/** 烘焙曲线采样点 */
export interface RoastCurvePoint {
  /** 秒 */
  t: number
  /** 豆温 °C */
  bt: number
  /** 环境温 °C */
  et: number
  /** 升温率 °C/min */
  ror: number
}

/**
 * 烘焙曲线（与后端 `roast_curves` 表 / `RoastCurve.to_dict()` 对应）。
 *
 * ⚠️ 注意：后端返回的是**对象** `{ points, events, ... }`，
 * 不是采样点数组 —— 与冲煮侧的 `BrewCurve { source, points, stages }` 同构。
 * 早期这里误声明成 `RoastCurvePoint[]`，导致图表拿到对象当数组用、曲线不渲染。
 */
export interface RoastCurve {
  id?: string
  ownerType?: string
  ownerId?: string
  /** 来源：live（硬件采样）/ keypoint（事件合成）/ import（.alog 导入） */
  source?: string
  xAxis?: string
  unit?: string
  points: RoastCurvePoint[]
  events?: RoastEvent[]
  meta?: Record<string, unknown>
}

/**
 * 提交烘焙批次时的 curve 载荷：**采样点数组**。
 *
 * 与读取形态不同 —— `POST /roasts` 的请求体里 curve 是点数组，
 * 响应里才是 `{ points, ... }` 对象（见 {@link RoastCurve}）。
 */
export type RoastCurvePayload = RoastCurvePoint[]

/**
 * 新建/更新烘焙批次的提交载荷。
 *
 * 与读取形态（{@link RoastBatch}）的区别：`curve` 是采样点数组而非对象。
 */
export interface RoastBatchPayload {
  beanId: string
  batchNo: string
  submissionId?: string
  roaster?: string
  greenGrams?: number
  outGrams?: number
  totalSeconds?: number
  events?: RoastEvent[]
  curve?: RoastCurvePayload
  dtrPercent?: number
  phaseRatio?: { drying: number; maillard: number; development: number }
  cuppingScore?: number
  notes?: string
  roastDate?: string
  /** 每炉的烘焙度（生豆分多炉时各炉独立） */
  roastLevel?: 'light' | 'medium' | 'medium_dark' | 'dark'
}

export const ROAST_EVENT_LABELS: Record<RoastEventType, string> = {
  charge: '投豆',
  turningPoint: '回温点',
  dryEnd: '脱水结束',
  firstCrack: '一爆',
  drop: '下豆'
}

/** 烘焙批次 */
export interface RoastBatch {
  id: string
  beanId: string
  batchNo: string
  roaster: string
  greenGrams: number
  outGrams: number
  weightLossPercent: number
  totalSeconds: number
  events: RoastEvent[]
  /** 发展比 % */
  dtrPercent: number
  phaseRatio: { drying: number; maillard: number; development: number }
  /** 烘焙曲线（对象，含 points 采样点数组）—— 见 {@link RoastCurve} */
  curve?: RoastCurve
  cuppingScore?: number
  notes?: string
  roastDate: string
  /** 每炉的烘焙度（生豆分多炉时各炉独立） */
  roastLevel?: 'light' | 'medium' | 'medium_dark' | 'dark'
  /** 炉次是否完成（有有效下豆时间与投豆量）—— 决定能否用于冲煮与养豆事件 */
  completed?: boolean
}

/** 器具 */
export interface Equipment {
  id: string
  type: 'grinder' | 'dripper' | 'brewer' | 'espresso' | 'scale' | 'roaster' | 'other'
  name: string
  brand?: string
  model?: string
  /** 磨豆机刻度基准（如「EK43 #22 = 0.8mm」） */
  notes?: string
  createdAt?: string
}

/** 配方模板 */
export interface Recipe {
  id: string
  name: string
  method: string
  params: Partial<BrewParams>
  steps: BrewStep[]
  notes?: string
  createdAt: string
}
