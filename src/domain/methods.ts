import type { BrewMethod, FlavorAxes, ParamSpec } from './types'

/**
 * 冲煮方式元数据表
 *
 * 这是「冲煮方式联动风味」的唯一数据源：每个方式自带
 *   1) 参数规格与建议区间   2) 研磨度提示
 *   3) 目标风味基线（雷达图基准轮廓）
 *   4) 推荐风味词库子类
 *   5) 黄金区间（TDS / 萃取率）
 *   6) 默认注水计划（用于生成理论曲线）
 *
 * 数据来源见 docs/00-产品与页面规划.md 第 3.1 节。
 */

const POUR_OVER_STEPS = (dose: number, water: number) => {
  const bloom = Math.round(dose * 2)
  const s1 = Math.round(water * 0.6)
  return [
    { atSecond: 0, toGrams: bloom, label: '闷蒸', stage: 'bloom' as const },
    { atSecond: 45, toGrams: s1, label: '第一段注水', stage: 'extraction' as const },
    { atSecond: 90, toGrams: water, label: '第二段注水', stage: 'extraction' as const },
    { atSecond: 165, toGrams: water, label: '滴滤完成', stage: 'drawdown' as const }
  ]
}

const RAW_METHODS: BrewMethod[] = [
  {
    id: 'pour_over_v60',
    name: '手冲 · V60',
    aliases: ['v60', '手冲', 'hario'],
    category: 'percolation',
    summary: '锥形滤杯 + 螺旋肋骨，单孔出水，流速由注水控制，风味自由度最高。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 30], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 250, range: [150, 500], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 165, range: [120, 300], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 93, range: [88, 96], unit: '°C' },
      preinfusionSeconds: { key: 'preinfusionSeconds', label: '闷蒸时长', required: false, default: 45, range: [0, 90], unit: 's' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细 · 砂糖颗粒' }
    },
    grindHint: '中细（砂糖颗粒）',
    flavorBaseline: { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 },
    flavorCategories: ['fruity', 'floral', 'sour_fermented'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['手冲', '三段式', '四六法'],
    defaultSteps: POUR_OVER_STEPS(15, 250)
  },
  {
    id: 'pour_over_kalita',
    name: '手冲 · Kalita Wave',
    aliases: ['kalita', 'kalita wave', '蛋糕杯'],
    category: 'percolation',
    summary: '平底三孔，粉层厚度一致，萃取更均匀稳定，适合新手。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 30], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 250, range: [150, 500], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 180, range: [150, 300], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 93, range: [88, 96], unit: '°C' },
      preinfusionSeconds: { key: 'preinfusionSeconds', label: '闷蒸时长', required: false, default: 45, range: [0, 90], unit: 's' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细 · 砂糖颗粒' }
    },
    grindHint: '中细（砂糖颗粒）',
    flavorBaseline: { acidity: 6, sweetness: 7, body: 5, flavor: 7, aftertaste: 7, balance: 8 },
    flavorCategories: ['fruity', 'nutty_cocoa', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['手冲'],
    defaultSteps: POUR_OVER_STEPS(15, 250)
  },
  {
    id: 'pour_over_origami',
    name: '手冲 · Origami',
    aliases: ['origami', '折纸滤杯'],
    category: 'percolation',
    summary: '折纸结构导流槽，流速顺畅，层次感丰富。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 30], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 250, range: [150, 500], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 170, range: [140, 280], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 92, range: [88, 96], unit: '°C' },
      preinfusionSeconds: { key: 'preinfusionSeconds', label: '闷蒸时长', required: false, default: 45, range: [0, 90], unit: 's' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细 · 砂糖颗粒' }
    },
    grindHint: '中细（砂糖颗粒）',
    flavorBaseline: { acidity: 7, sweetness: 6, body: 5, flavor: 8, aftertaste: 7, balance: 7 },
    flavorCategories: ['fruity', 'floral', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['手冲'],
    defaultSteps: POUR_OVER_STEPS(15, 250)
  },
  {
    id: 'chemex',
    name: 'Chemex',
    aliases: ['chemex', '化学壶'],
    category: 'percolation',
    summary: '双层厚滤纸，吸附油脂最多，液体极干净透明，体感轻盈。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 30, range: [20, 60], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 500, range: [300, 1000], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 240, range: [180, 420], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 94, range: [90, 96], unit: '°C' },
      preinfusionSeconds: { key: 'preinfusionSeconds', label: '闷蒸时长', required: false, default: 60, range: [0, 120], unit: 's' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中粗 · 粗海盐' }
    },
    grindHint: '中粗（粗海盐）',
    flavorBaseline: { acidity: 6, sweetness: 5, body: 3, flavor: 8, aftertaste: 7, balance: 7 },
    flavorCategories: ['floral', 'green_vegetal', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['手冲', '多人份'],
    defaultSteps: POUR_OVER_STEPS(30, 500)
  },
  {
    id: 'french_press',
    name: '法压壶',
    aliases: ['french press', '法压', 'fp'],
    category: 'immersion',
    summary: '全浸泡后压滤，油脂与细粉留在杯中，醇厚饱满。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 30], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 250, range: [150, 500], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '浸泡时长', required: true, default: 240, range: [180, 360], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 91, range: [88, 95], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '粗 · 粗海盐' }
    },
    grindHint: '粗（粗海盐）',
    flavorBaseline: { acidity: 3, sweetness: 7, body: 8, flavor: 5, aftertaste: 6, balance: 5 },
    flavorCategories: ['nutty_cocoa', 'other', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['浸泡', '粗研磨'],
    defaultSteps: [
      { atSecond: 0, toGrams: 250, label: '注水浸泡', stage: 'bloom' },
      { atSecond: 240, toGrams: 250, label: '压滤完成', stage: 'drawdown' }
    ]
  },
  {
    id: 'siphon',
    name: '虹吸壶',
    aliases: ['siphon', 'vacuum pot', '虹吸'],
    category: 'immersion',
    summary: '气压差驱动水循环上行，香气保留率高，口感圆润，需精准控温。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 30], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 225, range: [150, 400], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '萃取时长', required: true, default: 90, range: [60, 150], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 91, range: [88, 95], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细 · 砂糖颗粒' }
    },
    grindHint: '中细（砂糖颗粒）',
    flavorBaseline: { acidity: 6, sweetness: 7, body: 6, flavor: 7, aftertaste: 7, balance: 7 },
    flavorCategories: ['spices', 'other', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['浸泡', '循环萃取'],
    defaultSteps: [
      { atSecond: 0, toGrams: 225, label: '入粉注水', stage: 'bloom' },
      { atSecond: 90, toGrams: 225, label: '萃取完成', stage: 'drawdown' }
    ]
  },
  {
    id: 'moka',
    name: '摩卡壶',
    aliases: ['moka', 'moka pot', '摩卡'],
    category: 'pressure',
    summary: '蒸汽压力约 3bar，浓缩与滴滤之间，焦糖化风味显著。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 16, range: [10, 25], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '水量', required: true, default: 160, range: [100, 300], unit: 'g' },
      yieldGrams: { key: 'yieldGrams', label: '出液量', required: true, default: 90, range: [40, 200], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '加热时长', required: true, default: 150, range: [90, 240], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 100, range: [95, 100], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '细 · 比意式稍粗' }
    },
    grindHint: '细（比意式稍粗）',
    flavorBaseline: { acidity: 3, sweetness: 8, body: 8, flavor: 5, aftertaste: 6, balance: 5 },
    flavorCategories: ['roasted', 'nutty_cocoa', 'spices'],
    tdsRange: [8, 15],
    extractionRange: [18, 22],
    brewStyles: ['压力', '经典 Bialetti'],
    defaultSteps: [
      { atSecond: 0, toGrams: 160, label: '上壶注水', stage: 'bloom' },
      { atSecond: 150, toGrams: 160, label: '离火', stage: 'drawdown' }
    ]
  },
  {
    id: 'espresso',
    name: '意式浓缩',
    aliases: ['espresso', '意式', '浓缩'],
    category: 'pressure',
    summary: '9bar 高压 25-30 秒，高浓度与 Crema，甜苦集中的典型意式。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 18, range: [15, 22], unit: 'g' },
      yieldGrams: { key: 'yieldGrams', label: '液重', required: true, default: 36, range: [25, 50], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 40, range: [30, 60], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '萃取时间', required: true, default: 28, range: [20, 40], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 93, range: [88, 96], unit: '°C' },
      pressureBar: { key: 'pressureBar', label: '压力', required: true, default: 9, range: [6, 12], unit: 'bar' },
      preinfusionSeconds: { key: 'preinfusionSeconds', label: '预浸', required: false, default: 3, range: [0, 10], unit: 's' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '极细 · 面粉状' }
    },
    grindHint: '极细（面粉状）',
    flavorBaseline: { acidity: 4, sweetness: 6, body: 8, flavor: 6, aftertaste: 6, balance: 7 },
    flavorCategories: ['roasted', 'nutty_cocoa', 'sweet', 'spices'],
    tdsRange: [8, 12],
    extractionRange: [18, 22],
    brewStyles: ['espresso', 'ristretto', 'lungo', 'americano'],
    defaultSteps: [
      { atSecond: 0, toGrams: 0, label: '预浸', stage: 'preinfusion' },
      { atSecond: 3, toGrams: 4, label: '开始萃取', stage: 'extraction' },
      { atSecond: 28, toGrams: 36, label: '萃取完成', stage: 'drawdown' }
    ]
  },
  {
    id: 'aeropress',
    name: '爱乐压',
    aliases: ['aeropress', '爱乐'],
    category: 'immersion',
    summary: '浸泡 + 0.35bar 微压，可切换美式 / 浓缩 / 冷萃三种模式。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 25], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 220, range: [120, 400], unit: 'g' },
      yieldGrams: { key: 'yieldGrams', label: '出液量', required: true, default: 180, range: [80, 350], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 120, range: [60, 180], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 89, range: [80, 95], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细至细' }
    },
    grindHint: '中细至细',
    flavorBaseline: { acidity: 5, sweetness: 7, body: 7, flavor: 6, aftertaste: 6, balance: 7 },
    flavorCategories: ['other', 'nutty_cocoa', 'sweet'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['正压', '反压', '冰爱乐压'],
    defaultSteps: [
      { atSecond: 0, toGrams: 220, label: '注水搅拌', stage: 'bloom' },
      { atSecond: 90, toGrams: 220, label: '压滤', stage: 'extraction' },
      { atSecond: 120, toGrams: 220, label: '完成', stage: 'drawdown' }
    ]
  },
  {
    id: 'fp',
    name: '气压壶',
    aliases: ['fp-1', '气压壶', 'flair pro'],
    category: 'pressure',
    summary: '约 0.5bar 气压，浸泡与微压结合，油脂厚、酸低甜高。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 15, range: [10, 25], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '注水量', required: true, default: 220, range: [120, 400], unit: 'g' },
      yieldGrams: { key: 'yieldGrams', label: '出液量', required: true, default: 190, range: [80, 350], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '总时长', required: true, default: 120, range: [60, 180], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 89, range: [80, 95], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '中细' }
    },
    grindHint: '中细',
    flavorBaseline: { acidity: 4, sweetness: 8, body: 7, flavor: 6, aftertaste: 6, balance: 6 },
    flavorCategories: ['nutty_cocoa', 'sweet', 'other'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['浸泡', '气压'],
    defaultSteps: [
      { atSecond: 0, toGrams: 220, label: '注水', stage: 'bloom' },
      { atSecond: 120, toGrams: 220, label: '压滤完成', stage: 'drawdown' }
    ]
  },
  {
    id: 'cold_brew',
    name: '冷萃',
    aliases: ['cold brew', '冷泡'],
    category: 'cold',
    summary: '冷藏长时间浸泡，酸度显著下降、甜感突出，pH 约 5.5-6。',
    params: {
      doseGrams: { key: 'doseGrams', label: '粉量', required: true, default: 100, range: [50, 250], unit: 'g' },
      waterGrams: { key: 'waterGrams', label: '水量', required: true, default: 1000, range: [500, 2000], unit: 'g' },
      yieldGrams: { key: 'yieldGrams', label: '出液量', required: true, default: 900, range: [400, 1800], unit: 'g' },
      brewSeconds: { key: 'brewSeconds', label: '浸泡时长', required: true, default: 54000, range: [43200, 86400], unit: 's' },
      temperature: { key: 'temperature', label: '水温', required: true, default: 4, range: [0, 10], unit: '°C' },
      grindSetting: { key: 'grindSetting', label: '研磨度', required: false, hint: '粗' }
    },
    grindHint: '粗',
    flavorBaseline: { acidity: 2, sweetness: 8, body: 6, flavor: 5, aftertaste: 6, balance: 7 },
    flavorCategories: ['sweet', 'other', 'nutty_cocoa'],
    tdsRange: [1.15, 1.45],
    extractionRange: [18, 22],
    brewStyles: ['冷萃'],
    defaultSteps: [
      { atSecond: 0, toGrams: 1000, label: '注水冷藏', stage: 'bloom' },
      { atSecond: 54000, toGrams: 1000, label: '过滤完成', stage: 'drawdown' }
    ]
  }
]

/**
 * 各方式的粉液比规格
 *
 * 粉水比是由「粉量 / 注水量」派生的，不作为输入项渲染，
 * 但要参与区间校验（超出区间即提示欠萃或过萃风险），所以 derived 保持 false。
 */
const RATIO_SPECS: Record<string, ParamSpec> = {
  pour_over_v60: { key: 'ratio', label: '粉水比', required: true, target: 15, range: [13, 18] },
  pour_over_kalita: { key: 'ratio', label: '粉水比', required: true, target: 15, range: [13, 17] },
  pour_over_origami: { key: 'ratio', label: '粉水比', required: true, target: 15, range: [13, 17] },
  chemex: { key: 'ratio', label: '粉水比', required: true, target: 16.5, range: [16, 18] },
  french_press: { key: 'ratio', label: '粉水比', required: true, target: 16, range: [15, 18] },
  siphon: { key: 'ratio', label: '粉水比', required: true, target: 13.5, range: [12, 15] },
  moka: { key: 'ratio', label: '粉水比', required: true, target: 7, range: [5, 10] },
  espresso: { key: 'ratio', label: '粉液比', required: true, target: 2, range: [1.5, 3] },
  aeropress: { key: 'ratio', label: '粉水比', required: true, target: 14, range: [12, 16] },
  fp: { key: 'ratio', label: '粉水比', required: true, target: 14, range: [12, 16] },
  cold_brew: { key: 'ratio', label: '粉水比', required: true, target: 10, range: [8, 15] }
}

/** 注入粉液比规格后的完整方式表 */
export const BREW_METHODS: BrewMethod[] = RAW_METHODS.map(m => ({
  ...m,
  params: { ...m.params, ratio: RATIO_SPECS[m.id] }
}))

export const METHOD_MAP: Record<string, BrewMethod> = BREW_METHODS.reduce(
  (acc, m) => {
    acc[m.id] = m
    return acc
  },
  {} as Record<string, BrewMethod>
)

/** 按 id 或别名查找方式；找不到返回 undefined */
export function findMethod(idOrAlias: string): BrewMethod | undefined {
  const key = idOrAlias.trim().toLowerCase()
  if (METHOD_MAP[key]) return METHOD_MAP[key]
  return BREW_METHODS.find(
    m => m.id.toLowerCase() === key || m.aliases.some(a => a.toLowerCase() === key)
  )
}

/** 取方式的目标风味基线，找不到时给一个中性基线 */
export function getFlavorBaseline(methodId: string): FlavorAxes {
  return (
    METHOD_MAP[methodId]?.flavorBaseline ?? {
      acidity: 5,
      sweetness: 5,
      body: 5,
      flavor: 5,
      aftertaste: 5,
      balance: 5
    }
  )
}

/** 粉水比（water / dose） */
export function calcRatio(params: { doseGrams: number; waterGrams: number }): number {
  if (!params.doseGrams) return 0
  return Number((params.waterGrams / params.doseGrams).toFixed(2))
}

/** 参数越界检查：返回超出区间的字段 */
export function validateParams(
  methodId: string,
  params: Record<string, number | string | undefined>
): { field: string; label: string; value: number; range: [number, number]; severity: 'warn' | 'error' }[] {
  const method = METHOD_MAP[methodId]
  if (!method) return []
  const issues: ReturnType<typeof validateParams> = []
  Object.entries(method.params).forEach(([key, spec]) => {
    if (!spec.range || spec.derived) return
    const raw = params[key]
    if (typeof raw !== 'number') return
    const [min, max] = spec.range
    if (raw < min || raw > max) {
      // 偏离区间 25% 以上视为错误，否则为警告
      const span = max - min || 1
      const deviation = raw < min ? (min - raw) / span : (raw - max) / span
      issues.push({
        field: key,
        label: spec.label,
        value: raw,
        range: spec.range,
        severity: deviation > 0.25 ? 'error' : 'warn'
      })
    }
  })
  return issues
}
