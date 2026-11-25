import type { BrewCurve, BrewStep, CurvePoint, CurveStage, CurveStageSpan } from '../types'
import { smoothCurve, type KeyPoint } from './interpolate'

/**
 * 冲煮曲线生成
 *
 * 三种来源统一抽象为 CurveSource：
 *   plan     —— 由注水计划生成理论曲线（无需硬件）
 *   keypoint —— 用户在计时中打的关键点，插值补全
 *   device   —— 蓝牙秤 / CSV 采集到的原始序列（此处只做清洗与流速计算）
 */

export const STAGE_LABELS: Record<CurveStage, string> = {
  preinfusion: '预浸',
  bloom: '闷蒸',
  extraction: '萃取',
  drawdown: '滴滤'
}

/** 闷蒸/首段注水的实际注水动作时长（秒） */
const POUR_DURATION = 8

/** 由注水计划推导阶段区间 */
export function deriveStages(steps: BrewStep[], totalSeconds: number): CurveStageSpan[] {
  if (!steps.length) return []
  const spans: CurveStageSpan[] = []
  const first = steps[0]
  const second = steps[1]

  if (second) {
    spans.push({ from: 0, to: second.atSecond, label: first.label, stage: first.stage })
    for (let i = 1; i < steps.length - 1; i++) {
      spans.push({
        from: steps[i].atSecond,
        to: steps[i + 1].atSecond,
        label: steps[i].label,
        stage: steps[i].stage
      })
    }
    const last = steps[steps.length - 1]
    spans.push({
      from: last.atSecond,
      to: Math.max(last.atSecond, totalSeconds),
      label: last.label,
      stage: last.stage
    })
  } else {
    spans.push({
      from: 0,
      to: Math.max(first.atSecond, totalSeconds),
      label: first.label,
      stage: first.stage
    })
  }
  return spans
}

/** 根据时间戳判定所处阶段 */
export function stageAt(stages: CurveStageSpan[], t: number): CurveStage {
  for (const s of stages) {
    if (t >= s.from && t <= s.to) return s.stage
  }
  return stages.length ? stages[stages.length - 1].stage : 'extraction'
}

/**
 * 瞬时流速（克/秒）
 * 对累计重量做差分，再用滑动平均抹掉称重抖动
 */
export function computeFlow(points: { t: number; w: number }[], window = 3): number[] {
  const raw: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      raw.push(0)
      continue
    }
    const prev = points[i - 1]
    const dt = points[i].t - prev.t
    raw.push(dt > 0 ? Math.max(0, (points[i].w - prev.w) / dt) : 0)
  }
  if (window <= 1) return raw
  const smoothed: number[] = []
  const half = Math.floor(window / 2)
  for (let i = 0; i < raw.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(raw.length - 1, i + half); j++) {
      sum += raw[j]
      count++
    }
    smoothed.push(count ? sum / count : 0)
  }
  return smoothed
}

/**
 * 由注水计划生成理论曲线
 */
export function generatePlanCurve(steps: BrewStep[], totalSeconds: number): BrewCurve {
  const stages = deriveStages(steps, totalSeconds)
  const keypoints: KeyPoint[] = [{ t: 0, w: 0 }]

  steps.forEach((s, i) => {
    if (i === 0 && s.atSecond === 0) {
      // 首段是一次快速注水动作，用 POUR_DURATION 表现这段上升
      const next = steps[1]
      const end = Math.min(POUR_DURATION, next ? Math.max(1, next.atSecond - 1) : POUR_DURATION)
      keypoints.push({ t: end, w: s.toGrams })
    } else {
      keypoints.push({ t: s.atSecond, w: s.toGrams })
    }
  })

  const last = keypoints[keypoints.length - 1]
  if (totalSeconds > last.t) {
    keypoints.push({ t: totalSeconds, w: last.w })
  }

  const smoothed = smoothCurve(keypoints, 1)
  const flows = computeFlow(smoothed)

  const points: CurvePoint[] = smoothed.map((p, i) => ({
    t: Math.round(p.t),
    w: Number(p.w.toFixed(2)),
    flow: Number((flows[i] ?? 0).toFixed(3)),
    stage: stageAt(stages, p.t)
  }))

  return { source: 'plan', points, stages }
}

/**
 * 由关键点生成曲线
 * @param keypoints 用户记录的（时刻, 累计重量）
 */
export function generateKeypointCurve(
  keypoints: { t: number; w: number }[],
  stages?: CurveStageSpan[]
): BrewCurve {
  if (!keypoints.length) {
    return { source: 'keypoint', points: [], stages: [] }
  }
  const sorted = [...keypoints].sort((a, b) => a.t - b.t)
  const total = sorted[sorted.length - 1].t
  const spans = stages ?? deriveStagesFromKeypoints(sorted, total)
  const smoothed = smoothCurve(sorted, 1)
  const flows = computeFlow(smoothed)
  const points: CurvePoint[] = smoothed.map((p, i) => ({
    t: Math.round(p.t),
    w: Number(p.w.toFixed(2)),
    flow: Number((flows[i] ?? 0).toFixed(3)),
    stage: stageAt(spans, p.t)
  }))
  return { source: 'keypoint', points, stages: spans }
}

/** 无注水计划时，按关键点均分阶段 */
function deriveStagesFromKeypoints(
  sorted: { t: number; w: number }[],
  total: number
): CurveStageSpan[] {
  if (sorted.length < 2) return [{ from: 0, to: total, label: '萃取', stage: 'extraction' }]
  const seg = Math.max(1, Math.floor((sorted.length - 1) / 2))
  const mid = sorted[seg].t
  return [
    { from: 0, to: mid, label: '闷蒸', stage: 'bloom' },
    { from: mid, to: total, label: '萃取', stage: 'extraction' }
  ]
}

/**
 * 清洗设备采集的原始序列
 * @param raw 原始 (t 秒, w 克)
 */
export function cleanDeviceCurve(raw: { t: number; w: number }[]): BrewCurve {
  const sorted = [...raw].sort((a, b) => a.t - b.t)
  // 去掉累计重量倒退的噪点（称重抖动）
  const cleaned: { t: number; w: number }[] = []
  let lastW = -Infinity
  sorted.forEach(p => {
    if (p.w >= lastW) {
      cleaned.push(p)
      lastW = p.w
    }
  })
  const stages = deriveStagesFromKeypoints(cleaned, cleaned.length ? cleaned[cleaned.length - 1].t : 0)
  const flows = computeFlow(cleaned, 5)
  const points: CurvePoint[] = cleaned.map((p, i) => ({
    t: Math.round(p.t),
    w: Number(p.w.toFixed(2)),
    flow: Number((flows[i] ?? 0).toFixed(3)),
    stage: stageAt(stages, p.t)
  }))
  return { source: 'device', points, stages }
}

/** 曲线的关键统计：总时长、最终重量、平均流速、峰值流速 */
export function curveStats(curve: BrewCurve) {
  const pts = curve.points
  if (!pts.length) {
    return { duration: 0, finalWeight: 0, avgFlow: 0, peakFlow: 0 }
  }
  const duration = pts[pts.length - 1].t
  const finalWeight = pts[pts.length - 1].w
  const peak = pts.reduce((m, p) => (p.flow > m ? p.flow : m), 0)
  const avg = pts.reduce((s, p) => s + p.flow, 0) / pts.length
  return {
    duration,
    finalWeight: Number(finalWeight.toFixed(1)),
    avgFlow: Number(avg.toFixed(3)),
    peakFlow: Number(peak.toFixed(3))
  }
}
