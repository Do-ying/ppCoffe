import type { BrewMethod, FlavorAxes, FlavorProfile } from '../types'
import { FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS } from '../types'
import { axesDelta, matchScore } from '../flavor'

/**
 * 风味偏差诊断引擎
 *
 * 核心思想：把「用户喝到的风味」与「该冲煮方式的目标风味基线」做对比，
 * 再用咖啡萃取的因果链反推「下一杯该改什么」。
 *
 * 判定依据（见 docs/00-产品与页面规划.md 第 3.3 节）：
 *   尖酸、缺乏甜感、余韵短   → 萃取不足
 *   苦、干涩、发干、空洞     → 萃取过度
 *   酸质够但甜感缺失         → 萃取不均 / 研磨细分粉问题
 *   意式出现尖酸锐利         → 浓度放大酸质
 *   风味淡薄如水             → 粉水比过低或萃取不均
 *   焦糊烟熏                 → 局部过热或烘焙过深
 */

export type Verdict = 'under_extracted' | 'over_extracted' | 'uneven' | 'flat' | 'ok'

export interface Deviation {
  axis: keyof FlavorAxes
  label: string
  actual: number
  expected: number
  delta: number
  direction: 'over' | 'under'
}

export type PrescriptionAction =
  | 'grind_finer'
  | 'grind_coarser'
  | 'dose_up'
  | 'dose_down'
  | 'raise_temp'
  | 'lower_temp'
  | 'extend_time'
  | 'shorten_time'
  | 'stronger_pour'
  | 'gentler_pour'
  | 'better_agitation'
  | 'change_bean'
  | 'check_roast'
  | 'keep'

export interface Prescription {
  priority: number
  action: PrescriptionAction
  label: string
  /** 建议调整幅度 */
  delta?: string
  reason: string
  category: 'grind' | 'ratio' | 'temp' | 'time' | 'technique' | 'bean' | 'roast' | 'keep'
}

export interface Diagnosis {
  matchScore: number
  verdict: Verdict
  verdictLabel: string
  deviations: Deviation[]
  prescriptions: Prescription[]
  baseline: FlavorAxes
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  under_extracted: '萃取不足',
  over_extracted: '萃取过度',
  uneven: '萃取不均',
  flat: '风味平淡',
  ok: '风味吻合'
}

const AXIS_REASON: Record<keyof FlavorAxes, string> = {
  acidity: '酸质',
  sweetness: '甜感',
  body: '醇厚',
  flavor: '风味强度',
  aftertaste: '余韵',
  balance: '平衡'
}

/** 计算偏差列表 */
export function computeDeviations(actual: FlavorAxes, baseline: FlavorAxes): Deviation[] {
  const delta = axesDelta(actual, baseline)
  return FLAVOR_AXIS_KEYS.map(k => ({
    axis: k,
    label: FLAVOR_AXIS_LABELS[k],
    actual: actual[k],
    expected: baseline[k],
    delta: delta[k],
    direction: (delta[k] >= 0 ? 'over' : 'under') as 'over' | 'under'
  }))
    .filter(d => Math.abs(d.delta) >= 2)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

/**
 * 主诊断入口
 * @param method 冲煮方式（提供目标基线与方式特性）
 * @param flavor 用户记录的风味
 */
export function diagnose(method: BrewMethod, flavor: FlavorProfile): Diagnosis {
  const baseline = method.flavorBaseline
  const actual = flavor.axes
  const score = matchScore(actual, baseline)
  const deviations = computeDeviations(actual, baseline)

  const d = (k: keyof FlavorAxes) => actual[k] - baseline[k]

  // 欠萃倾向：酸质高于基线 + 甜感低于基线
  const underScore = d('acidity') * 1.2 + (d('sweetness') * -1) * 1.0 + d('balance') * -0.5
  // 过萃倾向：醇厚偏高 + 平衡/余韵偏低
  const overScore = d('body') * 0.8 + (d('balance') * -1) * 1.0 + (d('aftertaste') * -1) * 0.8
  // 平淡：所有轴都低于基线
  const allLow = FLAVOR_AXIS_KEYS.every(k => d(k) <= -2)
  // 不均：酸甜都高但平衡低（尖酸与高甜同时出现通常说明萃取不均）
  const uneven = d('acidity') >= 2 && d('sweetness') >= 2 && d('balance') <= -2

  let verdict: Verdict = 'ok'
  if (allLow) verdict = 'flat'
  else if (uneven) verdict = 'uneven'
  else if (underScore >= 2) verdict = 'under_extracted'
  else if (overScore >= 2) verdict = 'over_extracted'

  const prescriptions = buildPrescriptions(verdict, method, flavor)

  return {
    matchScore: score,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    deviations,
    prescriptions,
    baseline
  }
}

function buildPrescriptions(
  verdict: Verdict,
  method: BrewMethod,
  flavor: FlavorProfile
): Prescription[] {
  const list: Prescription[] = []
  const push = (p: Omit<Prescription, 'priority'>) => list.push({ ...p, priority: list.length + 1 })

  const isEspresso = method.category === 'pressure' && method.id === 'espresso'
  const isPourOver = method.category === 'percolation'

  switch (verdict) {
    case 'under_extracted':
      push({
        action: 'grind_finer',
        label: '研磨调细',
        delta: '1-2 格',
        reason: '酸质高于该方式的基线且甜感不足，是典型的欠萃特征',
        category: 'grind'
      })
      push({
        action: 'dose_up',
        label: '增加粉量',
        delta: '粉水比上调 0.5',
        reason: '提高浓度以补上缺失的甜感与醇厚',
        category: 'ratio'
      })
      push({
        action: 'raise_temp',
        label: '提高水温',
        delta: '+2℃',
        reason: isPourOver
          ? '浅焙豆在当前水温下溶出不足，提高水温能加快萃取'
          : '提高水温可加快萃取速率',
        category: 'temp'
      })
      push({
        action: 'extend_time',
        label: '延长萃取时间',
        delta: '+10s',
        reason: '延长接触时间，补足欠萃的甜感与余韵',
        category: 'time'
      })
      if (isPourOver) {
        push({
          action: 'stronger_pour',
          label: '加强搅拌与注水',
          reason: '加强扰动可提升萃取均匀度，减少局部欠萃',
          category: 'technique'
        })
      }
      if (isEspresso) {
        push({
          action: 'change_bean',
          label: '考虑换豆或加深烘焙',
          reason: '高浓度会放大浅焙豆的酸锐度，换低酸豆或更深烘焙更适配意式',
          category: 'bean'
        })
      }
      break

    case 'over_extracted':
      push({
        action: 'grind_coarser',
        label: '研磨调粗',
        delta: '1-2 格',
        reason: '苦感与干涩感偏重，通常是研磨过细导致的过度萃取',
        category: 'grind'
      })
      push({
        action: 'shorten_time',
        label: '缩短萃取时间',
        delta: '-10s',
        reason: '减少与咖啡粉的接触时间，拉回苦感',
        category: 'time'
      })
      push({
        action: 'lower_temp',
        label: '降低水温',
        delta: '-2℃',
        reason: '降低溶出速率，避免后段苦咸物质被带出',
        category: 'temp'
      })
      push({
        action: 'gentler_pour',
        label: '减缓注水',
        reason: '减缓扰动可降低萃取强度',
        category: 'technique'
      })
      break

    case 'uneven':
      push({
        action: 'better_agitation',
        label: '改善搅拌均匀度',
        reason: '酸甜同时偏高而平衡度偏低，典型的萃取不均——粉层有局部过萃与局部欠萃并存',
        category: 'technique'
      })
      push({
        action: 'check_roast',
        label: '检查熟豆新鲜度与细粉',
        reason: '细粉过多或豆子不新鲜都会造成萃取不均',
        category: 'roast'
      })
      push({
        action: 'dose_up',
        label: '适当增加粉量',
        delta: '+1g',
        reason: '更厚的粉床能提高萃取稳定性',
        category: 'ratio'
      })
      break

    case 'flat':
      push({
        action: 'dose_up',
        label: '提高粉水比',
        delta: '粉水比收紧 1',
        reason: '各项风味都偏弱，说明浓度不足，先把粉水比拉近',
        category: 'ratio'
      })
      push({
        action: 'raise_temp',
        label: '提高水温',
        delta: '+2℃',
        reason: '适度提高水温提升整体强度与甜感',
        category: 'temp'
      })
      break

    case 'ok':
    default:
      push({
        action: 'keep',
        label: '保持当前配方',
        reason: `风味与${method.name}的目标基线吻合度 ${matchScore(flavor.axes, method.flavorBaseline)}%`,
        category: 'keep'
      })
      push({
        action: 'grind_finer',
        label: '下一杯只改一个变量',
        delta: '建议从研磨度开始',
        reason: '一次只改一个变量，才能把风味变化归因清楚',
        category: 'keep'
      })
      break
  }

  // 缺陷标记的补充建议
  if (flavor.defects.some(x => x.id === 'burnt' || x.id === 'smoky')) {
    push({
      action: 'check_roast',
      label: '检查烘焙曲线',
      reason: '出现焦糊/烟熏，通常来自烘焙过深或 RoR crash，也可能是注水流速过慢造成的局部过热',
      category: 'roast'
    })
  }
  if (flavor.defects.some(x => x.id === 'papery' || x.id === 'woody')) {
    push({
      action: 'check_roast',
      label: '检查豆子新鲜度',
      reason: '纸板味/木质味通常指向氧化过度，注意烘焙日期与养豆期',
      category: 'roast'
    })
  }

  // 重新编号
  return list.map((p, i) => ({ ...p, priority: i + 1 }))
}

/** 偏差轴的中文说明，供 UI 直接展示 */
export function describeDeviation(d: Deviation): string {
  const axis = AXIS_REASON[d.axis]
  return `${axis}${d.direction === 'over' ? '偏高' : '偏低'} ${Math.abs(d.delta)} 分（实测 ${d.actual} / 目标 ${d.expected}）`
}
