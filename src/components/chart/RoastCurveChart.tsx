import { useEffect, useMemo, useRef } from 'react'
import Taro from '@tarojs/taro'
import { Canvas } from '@tarojs/components'
import type { RoastCurvePoint, RoastEvent } from '../../domain/types'
import { ROAST_EVENT_LABELS } from '../../domain/types'
import { chartPalette } from '../../styles/colors'
import { createChartContext } from '../../platform/chartContext'
import { useResolvedTheme } from '../../store/useTheme'

/**
 * 烘焙曲线图（Canvas 自绘）
 *
 * 三通道：
 *   BT  豆温     —— 主曲线（信号色，粗）
 *   ET  环境温   —— 次曲线（琥珀色，细）
 *   RoR 升温率   —— 副轴（危险色，细）
 * 另有阶段色带（脱水 / 梅纳 / 发展）与事件标记（投豆 / 回温点 / 脱水结束 / 一爆 / 下豆）
 */

let chartSeq = 0

export interface RoastCurveChartProps {
  points: RoastCurvePoint[]
  events: RoastEvent[]
  height?: number
  /** 叠加对比批次 */
  overlays?: { label: string; points: RoastCurvePoint[]; color?: string }[]
}

export default function RoastCurveChart({
  points,
  events,
  height = 280,
  overlays = []
}: RoastCurveChartProps) {
  const canvasId = useMemo(() => `pp_roast_${++chartSeq}`, [])
  const drawRef = useRef<() => boolean>(() => true)
  const { theme } = useResolvedTheme()

  const width = useMemo(() => {
    try {
      const sys = Taro.getSystemInfoSync()
      return Math.max(280, sys.windowWidth - 48)
    } catch {
      return 320
    }
  }, [])

  const draw = (): boolean => {
    if (!points.length) return true
    const ctx = createChartContext(canvasId)
    if (!ctx) return false
    const C = chartPalette(theme)

    const padL = 36
    const padR = 46
    const padT = 26
    const padB = 30
    const w = width - padL - padR
    const h = height - padT - padB

    const allPoints = [...points, ...overlays.flatMap(o => o.points)]
    const maxT = Math.max(...allPoints.map(p => p.t), 1)
    const maxTemp = Math.max(...allPoints.map(p => Math.max(p.bt, p.et)), 100)
    const maxRor = Math.max(...allPoints.map(p => p.ror), 5)

    const X = (t: number) => padL + (t / maxT) * w
    const Y = (temp: number) => padT + h - (temp / maxTemp) * h
    const YR = (r: number) => padT + h - (r / maxRor) * h

    // 阶段色带
    const de = events.find(e => e.type === 'dryEnd')
    const fc = events.find(e => e.type === 'firstCrack')
    const drop = events.find(e => e.type === 'drop')
    const bands: { from: number; to: number; color: string }[] = []
    if (de) bands.push({ from: 0, to: de.atSecond, color: C.stage.preinfusion })
    if (de && fc) bands.push({ from: de.atSecond, to: fc.atSecond, color: C.stage.bloom })
    if (fc && drop) bands.push({ from: fc.atSecond, to: drop.atSecond, color: C.stage.drawdown })
    bands.forEach(b => {
      ctx.setFillStyle(b.color)
      ctx.setGlobalAlpha(0.1)
      ctx.fillRect(X(b.from), padT, Math.max(1, X(b.to) - X(b.from)), h)
      ctx.setGlobalAlpha(1)
    })

    // 网格与刻度
    ctx.setStrokeStyle(C.line)
    ctx.setLineWidth(1)
    for (let i = 0; i <= 4; i++) {
      const y = padT + (h / 4) * i
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + w, y)
      ctx.stroke()
    }
    ctx.setFillStyle(C.textMute)
    ctx.setFontSize(9)
    for (let i = 0; i <= 4; i++) {
      const v = maxTemp * (1 - i / 4)
      ctx.fillText(`${Math.round(v)}°`, 4, padT + (h / 4) * i + 3)
      const r = maxRor * (1 - i / 4)
      ctx.fillText(`${r.toFixed(0)}`, padL + w + 6, padT + (h / 4) * i + 3)
    }
    for (let i = 0; i <= 4; i++) {
      const t = (maxT / 4) * i
      ctx.fillText(`${Math.round(t)}s`, X(t) - 8, height - 10)
    }

    // 叠加批次（先画）
    overlays.forEach(o => {
      if (!o.points.length) return
      ctx.setStrokeStyle(o.color || C.amber)
      ctx.setLineWidth(1.5)
      ctx.setGlobalAlpha(0.75)
      ctx.beginPath()
      o.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(X(p.t), Y(p.bt))
        else ctx.lineTo(X(p.t), Y(p.bt))
      })
      ctx.stroke()
      ctx.setGlobalAlpha(1)
    })

    // ET 环境温
    ctx.setStrokeStyle(C.amber)
    ctx.setLineWidth(1)
    ctx.setGlobalAlpha(0.75)
    ctx.beginPath()
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.t), Y(p.et))
      else ctx.lineTo(X(p.t), Y(p.et))
    })
    ctx.stroke()
    ctx.setGlobalAlpha(1)

    // RoR 升温率（副轴）
    ctx.setStrokeStyle(C.danger)
    ctx.setLineWidth(1)
    ctx.setGlobalAlpha(0.85)
    ctx.beginPath()
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.t), YR(p.ror))
      else ctx.lineTo(X(p.t), YR(p.ror))
    })
    ctx.stroke()
    ctx.setGlobalAlpha(1)

    // BT 豆温（主曲线）
    ctx.setStrokeStyle(C.signal)
    ctx.setLineWidth(2)
    ctx.beginPath()
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.t), Y(p.bt))
      else ctx.lineTo(X(p.t), Y(p.bt))
    })
    ctx.stroke()

    // 事件标记（标签上下错开，避免密集时重叠）
    ctx.setFontSize(9)
    events.forEach((e, idx) => {
      const x = X(e.atSecond)
      ctx.setStrokeStyle(C.lineStrong)
      ctx.setLineWidth(1)
      ctx.setLineDash([2, 3], 0)
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, padT + h)
      ctx.stroke()
      ctx.setLineDash([], 0)
      ctx.setFillStyle(C.textDim)
      const labelY = padT + 9 + (idx % 2) * 13
      ctx.fillText(ROAST_EVENT_LABELS[e.type], Math.min(x + 3, width - 46), labelY)
    })

    ctx.draw()
    return true
  }

  drawRef.current = draw

  useEffect(() => {
    let tries = 0
    let handle: number | undefined
    const attempt = () => {
      if (drawRef.current()) return
      if (tries++ > 30) return
      handle =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(attempt)
          : (setTimeout(attempt, 16) as unknown as number)
    }
    attempt()
    return () => {
      if (handle === undefined) return
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
    }
  })

  if (!points.length) {
    return (
      <view className="curve-chart curve-chart--empty">
        <text className="mute">暂无烘焙曲线数据</text>
      </view>
    )
  }

  return (
    <view className="curve-chart">
      <Canvas
        canvasId={canvasId}
        id={canvasId}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </view>
  )
}
