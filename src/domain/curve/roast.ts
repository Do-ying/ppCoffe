import type { RoastEvent, RoastEventType, RoastCurvePoint } from '../types'
import { smoothCurve } from './interpolate'

/**
 * 烘豆曲线分析
 *
 * 指标口径对齐 Artisan（事实标准）：
 *   RoR  = dBT/dt，单位 °C/min，采用中心差分 + 30s 中心窗口平滑
 *   DTR  = (下豆时刻 - 一爆时刻) / 总时长
 *   阶段 = 脱水 / 梅纳 / 发展，依据事件标记切分
 */

export interface RoastPoint {
  /** 秒 */
  t: number
  /** 豆温 °C */
  bt: number
  /** 环境温 °C */
  et?: number
  /** 升温率 °C/min */
  ror?: number
}

/**
 * 计算升温率 RoR
 * @param points 豆温序列
 * @param windowSeconds 平滑窗口（秒），Artisan 默认 30
 */
export function computeRoR(points: RoastPoint[], windowSeconds = 30): number[] {
  const n = points.length
  const out: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    // 取窗口内最早的可用点
    let start = i
    while (start > 0 && points[i].t - points[start].t < windowSeconds) start--
    const end = Math.min(n - 1, i)
    const dt = points[end].t - points[start].t
    if (dt <= 0) {
      out[i] = 0
      continue
    }
    out[i] = ((points[end].bt - points[start].bt) / dt) * 60
  }
  // 轻度平滑，去除尖刺
  return out.map((v, i) => {
    const prev = out[i - 1] ?? v
    const next = out[i + 1] ?? v
    return Number(((prev + v * 2 + next) / 4).toFixed(2))
  })
}

export function findEvent(events: RoastEvent[], type: RoastEventType): RoastEvent | undefined {
  return events.find(e => e.type === type)
}

/** 发展比 DTR（%） */
export function computeDTR(events: RoastEvent[], totalSeconds: number): number {
  const fc = findEvent(events, 'firstCrack')
  const drop = findEvent(events, 'drop')
  if (!fc || !drop || !totalSeconds) return 0
  return Number((((drop.atSecond - fc.atSecond) / totalSeconds) * 100).toFixed(1))
}

/** 失重率（%） */
export function computeWeightLoss(greenGrams: number, outGrams: number): number {
  if (!greenGrams) return 0
  return Number((((greenGrams - outGrams) / greenGrams) * 100).toFixed(1))
}

/** 三个阶段的时长占比（%） */
export function computePhaseRatio(
  events: RoastEvent[],
  totalSeconds: number
): { drying: number; maillard: number; development: number } {
  const charge = findEvent(events, 'charge')
  const de = findEvent(events, 'dryEnd')
  const fc = findEvent(events, 'firstCrack')
  const drop = findEvent(events, 'drop')
  if (!charge || !de || !fc || !drop || !totalSeconds) {
    return { drying: 0, maillard: 0, development: 0 }
  }
  const pct = (v: number) => Number(((v / totalSeconds) * 100).toFixed(1))
  return {
    drying: pct(de.atSecond - charge.atSecond),
    maillard: pct(fc.atSecond - de.atSecond),
    development: pct(drop.atSecond - fc.atSecond)
  }
}

/** 完整的烘焙指标 */
export function computeRoastMetrics(batch: {
  greenGrams: number
  outGrams: number
  totalSeconds: number
  events: RoastEvent[]
}) {
  return {
    weightLossPercent: computeWeightLoss(batch.greenGrams, batch.outGrams),
    dtrPercent: computeDTR(batch.events, batch.totalSeconds),
    phaseRatio: computePhaseRatio(batch.events, batch.totalSeconds)
  }
}

/**
 * RoR 形态健康度检查
 * 典型健康形态：初期高（15-25℃/min）→ 梅纳期平稳下降 → 一爆前 5-15℃/min
 */
export interface RorAnomaly {
  type: 'crash' | 'flick' | 'low'
  atSecond: number
  value: number
  message: string
}

export function checkRorShape(points: RoastPoint[], events: RoastEvent[]): RorAnomaly[] {
  const ror = computeRoR(points)
  const anomalies: RorAnomaly[] = []
  const fc = findEvent(events, 'firstCrack')

  for (let i = 1; i < ror.length; i++) {
    const prev = ror[i - 1]
    const cur = ror[i]
    const t = points[i].t
    // Crash：RoR 骤降超过 3℃/min
    if (prev - cur > 3 && prev > 6) {
      anomalies.push({
        type: 'crash',
        atSecond: t,
        value: cur,
        message: `第 ${Math.round(t)} 秒 RoR 骤降 ${(prev - cur).toFixed(1)}℃/min，可能出现焦苦或 underdeveloped`
      })
    }
    // Flick：RoR 尖刺
    if (cur - prev > 2.5 && cur > 12) {
      anomalies.push({
        type: 'flick',
        atSecond: t,
        value: cur,
        message: `第 ${Math.round(t)} 秒 RoR 尖刺 ${(cur - prev).toFixed(1)}℃/min，可能着色不均或焦糊`
      })
    }
  }

  // 一爆前 RoR 过低：热力不足
  if (fc) {
    const before = points.filter(p => p.t < fc.atSecond).slice(-5)
    if (before.length) {
      const idx = points.findIndex(p => p.t === before[before.length - 1].t)
      const avg = before
        .map((_, i) => ror[idx - before.length + 1 + i])
        .filter(v => v !== undefined)
        .reduce((s, v) => s + v, 0) / before.length
      if (avg > 0 && avg < 3) {
        anomalies.push({
          type: 'low',
          atSecond: fc.atSecond,
          value: Number(avg.toFixed(2)),
          message: `一爆前 RoR 仅 ${avg.toFixed(1)}℃/min，发展期热量不足，可能影响甜感`
        })
      }
    }
  }
  return anomalies
}

/**
 * 解析 Artisan .alog 文件
 * .alog 为制表符分隔的 CSV，注释行以 # 开头，数据区有 "Bean Temp" 表头
 */export function parseArtisanAlog(text: string): {
  points: RoastPoint[]
  events: RoastEvent[]
  warnings: string[]
} {
  const warnings: string[] = []
  const points: RoastPoint[] = []
  const events: RoastEvent[] = []
  const lines = text.split(/\r?\n/)

  let header: string[] | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    // Artisan 的列名行同样带 # 前缀，这里统一剥掉后再判断是否为表头
    const cols = line.replace(/^#\s*/, '').split(/[\t,]/).map(c => c.trim())

    if (!header) {
      if (cols.some(c => /bean\s*temp/i.test(c))) {
        header = cols.map(c => c.toLowerCase())
      }
      continue
    }

    const pick = (pattern: RegExp, index: number) => {
      if (!header) return undefined
      const found = header.findIndex(h => pattern.test(h))
      if (found >= 0) {
        const v = parseFloat(cols[found])
        if (!Number.isNaN(v)) return v
      }
      const v = parseFloat(cols[index])
      return Number.isNaN(v) ? undefined : v
    }

    const t = pick(/^(time|t)$/, 0)
    if (t === undefined) continue
    const bt = pick(/bean/, 1)
    if (bt === undefined) continue
    const et = pick(/env/, 2)
    points.push({ t, bt, et })
  }

  // 尽力解析事件标记：形如 "First Crack, 348, 201" 或 "Charge: 0, 205"
  const EVENT_PATTERNS: { re: RegExp; type: RoastEventType }[] = [
    { re: /charge/i, type: 'charge' },
    { re: /turning\s*point|tp\b/i, type: 'turningPoint' },
    { re: /dry\s*end|de\b/i, type: 'dryEnd' },
    { re: /first\s*crack|\bfc\b/i, type: 'firstCrack' },
    { re: /drop/i, type: 'drop' }
  ]
  lines.forEach(raw => {
    const line = raw.replace(/^#\s*/, '').trim()
    if (!line || /bean\s*temp/i.test(line)) return
    for (const { re, type } of EVENT_PATTERNS) {
      if (!re.test(line)) continue
      const nums = line.match(/-?\d+(\.\d+)?/g)
      if (!nums || nums.length < 2) break
      const atSecond = Number(nums[0])
      const temperature = Number(nums[1])
      if (Number.isNaN(atSecond) || Number.isNaN(temperature)) break
      if (!events.some(e => e.type === type)) {
        events.push({ type, atSecond, temperature })
      }
      break
    }
  })

  if (!points.length) {
    warnings.push('未解析到数据行，请确认文件为 Artisan .alog 格式')
  }
  if (!events.length) {
    warnings.push('未检测到一爆/下豆事件标记，请在曲线详情页手工确认')
  }
  return { points, events, warnings }
}

/* ------------------------------------------------------------------ */
/*  由事件标记合成烘焙曲线（无硬件时的理论曲线）                        */
/* ------------------------------------------------------------------ */

/** 烘焙阶段 */
export type RoastPhase = 'drying' | 'maillard' | 'development'

export const ROAST_PHASE_LABELS: Record<RoastPhase, string> = {
  drying: '脱水',
  maillard: '梅纳',
  development: '发展'
}

/** 根据时间判定所处阶段 */
export function roastPhaseAt(t: number, events: RoastEvent[]): RoastPhase {
  const de = findEvent(events, 'dryEnd')
  const fc = findEvent(events, 'firstCrack')
  if (de && t < de.atSecond) return 'drying'
  if (fc && t < fc.atSecond) return 'maillard'
  return 'development'
}

/**
 * 由事件标记合成一条烘焙曲线
 *
 * - 豆温 BT：以事件点为关键点做单调三次插值（投豆高温 → 回温点骤降 → 持续爬升）
 * - 环境温 ET：按阶段经验值推算（脱水期接近豆温，脱水后高于豆温）
 * - 升温率 RoR：对 BT 序列差分得到（与 Artisan 的 30s 中心窗口口径一致）
 */
export function generateRoastCurve(
  events: RoastEvent[],
  totalSeconds: number,
  interval = 2
): RoastCurvePoint[] {
  const sorted = [...events].sort((a, b) => a.atSecond - b.atSecond)
  if (!sorted.length) return []

  const btKeys = sorted.map(e => ({ t: e.atSecond, w: e.temperature }))
  if (btKeys[0].t > 0) btKeys.unshift({ t: 0, w: btKeys[0].w })
  const bt = smoothCurve(btKeys, interval)

  const etKeys = sorted.map(e => {
    let et: number
    switch (e.type) {
      case 'charge':
        et = e.temperature * 0.88
        break
      case 'turningPoint':
        et = e.temperature + 62
        break
      case 'dryEnd':
        et = e.temperature + 42
        break
      case 'firstCrack':
        et = e.temperature + 30
        break
      default:
        et = e.temperature + 26
    }
    return { t: e.atSecond, w: et }
  })
  if (etKeys[0].t > 0) etKeys.unshift({ t: 0, w: etKeys[0].w })
  const et = smoothCurve(etKeys, interval)

  const ror = computeRoR(bt.map(p => ({ t: p.t, bt: p.w })))

  const out: RoastCurvePoint[] = []
  for (let i = 0; i < bt.length; i++) {
    const t = Math.min(Math.round(bt[i].t), totalSeconds)
    out.push({
      t,
      bt: Number(bt[i].w.toFixed(1)),
      et: Number((et[i]?.w ?? 0).toFixed(1)),
      ror: Number((ror[i] ?? 0).toFixed(2))
    })
  }
  return out
}

/** 曲线关键统计 */
export function roastCurveStats(points: RoastCurvePoint[]) {
  if (!points.length) {
    return { maxBt: 0, maxEt: 0, peakRor: 0, turningPoint: 0 }
  }
  const maxBt = Math.max(...points.map(p => p.bt))
  const maxEt = Math.max(...points.map(p => p.et))
  const peakRor = Math.max(...points.map(p => p.ror))
  // 转折点：豆温由降转升的最低点
  let turningPoint = 0
  let lowest = Infinity
  points.forEach(p => {
    if (p.bt < lowest) {
      lowest = p.bt
      turningPoint = p.t
    }
  })
  return { maxBt: Number(maxBt.toFixed(1)), maxEt: Number(maxEt.toFixed(1)), peakRor: Number(peakRor.toFixed(1)), turningPoint }
}
