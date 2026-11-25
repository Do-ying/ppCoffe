import { useEffect, useMemo, useRef } from 'react'
import Taro from '@tarojs/taro'
import { Canvas } from '@tarojs/components'
import type { CurvePoint, CurveStageSpan } from '../../domain/types'
import { chartPalette } from '../../styles/colors'
import { createChartContext } from '../../platform/chartContext'
import { useResolvedTheme } from '../../store/useTheme'

/**
 * 冲煮曲线图（Canvas 自绘）
 *
 * 为什么不用图表库：曲线需要「阶段色带 + 事件标记 + 多线叠加 + 长按读数」这些
 * 高度定制的能力，自绘可控且零依赖，也避开小程序包体积问题。
 *
 * 绘制时机：不能只在 useReady 里画一次 —— 数据异步到达会触发重渲染，
 * H5 端 Canvas DOM 会被重建，导致画在旧节点上（表现为空白）。
 * 因此改为「页面 ready + 数据变化」双条件触发重绘。
 */

let chartSeq = 0

export interface CurveChartProps {
  points: CurvePoint[]
  stages?: CurveStageSpan[]
  /** 高度 px */
  height?: number
  /** 是否叠加瞬时流速曲线 */
  showFlow?: boolean
  /** 叠加对比曲线 */
  overlays?: { label: string; points: CurvePoint[]; color?: string }[]
}

export default function CurveChart({
  points,
  stages = [],
  height = 240,
  showFlow = false,
  overlays = []
}: CurveChartProps) {
  const canvasId = useMemo(() => `pp_curve_${++chartSeq}`, [])
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
    const padL = 40
    const padR = 14
    const padT = 16
    const padB = 28
    const w = width - padL - padR
    const h = height - padT - padB

    const maxT = points[points.length - 1].t || 1
    const maxW = Math.max(
      ...points.map(p => p.w),
      ...overlays.flatMap(o => o.points.map(p => p.w)),
      1
    )
    const maxFlow = Math.max(...points.map(p => p.flow), 0.1)

    const X = (t: number) => padL + (t / maxT) * w
    const Y = (v: number) => padT + h - (v / maxW) * h
    const YF = (v: number) => padT + h - (v / maxFlow) * h * 0.5

    // 阶段色带
    stages.forEach(s => {
      const x1 = X(s.from)
      const x2 = X(Math.min(s.to, maxT))
      ctx.setFillStyle(C.stage[s.stage] || C.line)
      ctx.setGlobalAlpha(0.08)
      ctx.fillRect(x1, padT, Math.max(1, x2 - x1), h)
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
      const v = maxW * (1 - i / 4)
      ctx.fillText(`${Math.round(v)}g`, 6, padT + (h / 4) * i + 3)
    }

    // X 轴时间刻度
    ctx.setFillStyle(C.textMute)
    for (let i = 0; i <= 3; i++) {
      const t = (maxT / 3) * i
      const x = X(t)
      ctx.fillText(`${Math.round(t)}s`, x - 8, height - 10)
    }

    // 对比曲线（先画，压在主曲线下方）
    overlays.forEach(o => {
      if (!o.points.length) return
      ctx.setStrokeStyle(o.color || C.amber)
      ctx.setLineWidth(1.5)
      ctx.setGlobalAlpha(0.75)
      ctx.beginPath()
      o.points.forEach((p, i) => {
        const x = X(p.t)
        const y = Y(p.w)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.setGlobalAlpha(1)
    })

    // 瞬时流速（次轴）
    if (showFlow) {
      ctx.setStrokeStyle(C.amber)
      ctx.setLineWidth(1)
      ctx.setGlobalAlpha(0.7)
      ctx.beginPath()
      points.forEach((p, i) => {
        const x = X(p.t)
        const y = YF(p.flow)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.setGlobalAlpha(1)
    }

    // 主曲线
    ctx.setStrokeStyle(C.signal)
    ctx.setLineWidth(2)
    ctx.beginPath()
    points.forEach((p, i) => {
      const x = X(p.t)
      const y = Y(p.w)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // 终点标记
    const last = points[points.length - 1]
    ctx.setFillStyle(C.signal)
    ctx.beginPath()
    ctx.arc(X(last.t), Y(last.w), 3, 0, Math.PI * 2)
    ctx.fill()

    ctx.draw()
    return true
  }

  drawRef.current = draw

  useEffect(() => {
    // 每次渲染后都重绘：
    //   1) Taro H5 的 Canvas 组件每次渲染会重设 canvas.width/height，从而清空画布，
    //      所以不能只在数据变化时画一次，否则父组件重渲染后画布会变空白；
    //   2) 画布节点可能尚未挂载完成，取不到上下文时按帧重试。
    let tries = 0
    let handle: number | undefined
    const attempt = () => {
      const done = drawRef.current()
      if (done) return
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
        <text className="mute">暂无曲线数据</text>
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
