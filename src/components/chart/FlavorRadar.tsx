import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@tarojs/components'
import type { FlavorAxes } from '../../domain/types'
import { FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS } from '../../domain/types'
import { chartPalette } from '../../styles/colors'
import { createChartContext } from '../../platform/chartContext'
import { useResolvedTheme } from '../../store/useTheme'

/**
 * 风味雷达图
 *
 * 同时绘制「目标基线轮廓」与「本次实测定轮廓」，
 * 两者叠加的差值就是风味偏差的可视化 —— 这是诊断页的核心图形。
 *
 * 绘制时机与 CurveChart 一致：页面 ready 且数据变化时重绘，
 * 否则 H5 端数据异步到达会重建 Canvas DOM，导致画面空白。
 */

let radarSeq = 0

export interface FlavorRadarProps {
  actual: FlavorAxes
  baseline: FlavorAxes
  size?: number
}

export default function FlavorRadar({ actual, baseline, size = 280 }: FlavorRadarProps) {
  const canvasId = useMemo(() => `pp_radar_${++radarSeq}`, [])
  const drawRef = useRef<() => boolean>(() => true)
  const { theme } = useResolvedTheme()

  const draw = (): boolean => {
    const ctx = createChartContext(canvasId)
    if (!ctx) return false
    const C = chartPalette(theme)
    const cx = size / 2
    const cy = size / 2
    const radius = size / 2 - 44
    const n = FLAVOR_AXIS_KEYS.length

    const angleOf = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
    const pointAt = (i: number, value: number) => {
      const r = (value / 10) * radius
      return { x: cx + Math.cos(angleOf(i)) * r, y: cy + Math.sin(angleOf(i)) * r }
    }

    // 网格（4 圈）
    ctx.setStrokeStyle(C.line)
    ctx.setLineWidth(1)
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath()
      for (let i = 0; i <= n; i++) {
        const p = pointAt(i % n, (ring / 4) * 10)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    // 轴线
    for (let i = 0; i < n; i++) {
      const p = pointAt(i, 10)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }

    const drawPolygon = (axes: FlavorAxes, color: string, filled: boolean, dash: boolean) => {
      ctx.setStrokeStyle(color)
      ctx.setLineWidth(filled ? 2 : 1)
      if (dash) ctx.setLineDash([3, 3], 0)
      ctx.beginPath()
      FLAVOR_AXIS_KEYS.forEach((k, i) => {
        const p = pointAt(i, axes[k])
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      if (filled) {
        ctx.setFillStyle(color)
        ctx.setGlobalAlpha(0.14)
        ctx.fill()
        ctx.setGlobalAlpha(1)
      }
      ctx.stroke()
      ctx.setLineDash([], 0)
    }

    // 目标基线（虚线）
    drawPolygon(baseline, C.textMute, false, true)
    // 实测轮廓
    drawPolygon(actual, C.signal, true, false)

    // 顶点
    FLAVOR_AXIS_KEYS.forEach((k, i) => {
      const p = pointAt(i, actual[k])
      ctx.setFillStyle(C.axis[i])
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
      ctx.fill()
    })

    // 轴标签
    ctx.setFillStyle(C.textDim)
    ctx.setFontSize(11)
    FLAVOR_AXIS_KEYS.forEach((k, i) => {
      const p = pointAt(i, 13.2)
      ctx.fillText(FLAVOR_AXIS_LABELS[k], p.x - 14, p.y + 4)
    })

    ctx.draw()
    return true
  }

  drawRef.current = draw

  useEffect(() => {
    // 每次渲染后都重绘：Taro H5 的 Canvas 每次渲染会重设 canvas.width/height 并清空画布；
    // 取不到上下文时按帧重试，等待画布节点挂载完成。
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

  return (
    <view className="radar" style={{ width: `${size}px`, height: `${size}px` }}>
      <Canvas
        canvasId={canvasId}
        id={canvasId}
        style={{ width: `${size}px`, height: `${size}px` }}
      />
    </view>
  )
}
