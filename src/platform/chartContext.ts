import Taro from '@tarojs/taro'

/**
 * 图表上下文适配层
 *
 * 背景：Taro H5 的 Canvas 组件把 `canvas-id` 挂在包装元素 `<taro-canvas-core>` 上，
 * 内层 `<canvas>` 没有该属性，导致 `Taro.createCanvasContext()` 在 H5 端
 * 通过 `canvas[canvas-id="..."]` 查询时找不到节点（静默失效，画布空白）。
 *
 * 解决：H5 端直接取原生 CanvasRenderingContext2D，小程序端沿用 Taro 的
 * 旧版 CanvasContext，两者用同一套 ChartContext 接口封装，绘图代码零分支。
 *
 * `process.env.TARO_ENV` 会被构建期常量替换，H5 分支在小程序包里被完全剔除。
 */

export interface ChartContext {
  setStrokeStyle(color: string): void
  setFillStyle(color: string): void
  setLineWidth(width: number): void
  setGlobalAlpha(alpha: number): void
  setFontSize(size: number): void
  setLineDash(dash: number[], offset?: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fill(): void
  arc(x: number, y: number, r: number, start: number, end: number): void
  fillText(text: string, x: number, y: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  /** 提交绘制（原生上下文为立即生效，这里仅作语义对齐） */
  draw(): void
}

/** 小程序端：包装 Taro / 微信的旧版 CanvasContext */
class TaroChartContext implements ChartContext {
  private ctx: Taro.CanvasContext

  constructor(ctx: Taro.CanvasContext) {
    this.ctx = ctx
  }

  setStrokeStyle(color: string) {
    this.ctx.setStrokeStyle(color)
  }
  setFillStyle(color: string) {
    this.ctx.setFillStyle(color)
  }
  setLineWidth(width: number) {
    this.ctx.setLineWidth(width)
  }
  setGlobalAlpha(alpha: number) {
    this.ctx.setGlobalAlpha(alpha)
  }
  setFontSize(size: number) {
    // 直接写 font 属性：微信原生 CanvasContext 支持，且不会踩 H5 端 setFontSize 的坑
    this.ctx.font = `${size}px sans-serif`
  }
  setLineDash(dash: number[], offset = 0) {
    this.ctx.setLineDash(dash, offset)
  }
  beginPath() {
    this.ctx.beginPath()
  }
  closePath() {
    this.ctx.closePath()
  }
  moveTo(x: number, y: number) {
    this.ctx.moveTo(x, y)
  }
  lineTo(x: number, y: number) {
    this.ctx.lineTo(x, y)
  }
  stroke() {
    this.ctx.stroke()
  }
  fill() {
    this.ctx.fill()
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.ctx.arc(x, y, r, start, end)
  }
  fillText(text: string, x: number, y: number) {
    this.ctx.fillText(text, x, y)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.ctx.fillRect(x, y, w, h)
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.ctx.clearRect(x, y, w, h)
  }
  draw() {
    this.ctx.draw()
  }
}

/** H5 端：包装原生 CanvasRenderingContext2D */
class NativeChartContext implements ChartContext {
  private ctx: CanvasRenderingContext2D

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx
  }
  setStrokeStyle(color: string) {
    this.ctx.strokeStyle = color
  }
  setFillStyle(color: string) {
    this.ctx.fillStyle = color
  }
  setLineWidth(width: number) {
    this.ctx.lineWidth = width
  }
  setGlobalAlpha(alpha: number) {
    this.ctx.globalAlpha = alpha
  }
  setFontSize(size: number) {
    this.ctx.font = `${size}px sans-serif`
  }
  setLineDash(dash: number[], offset = 0) {
    this.ctx.setLineDash(dash)
    this.ctx.lineDashOffset = offset
  }
  beginPath() {
    this.ctx.beginPath()
  }
  closePath() {
    this.ctx.closePath()
  }
  moveTo(x: number, y: number) {
    this.ctx.moveTo(x, y)
  }
  lineTo(x: number, y: number) {
    this.ctx.lineTo(x, y)
  }
  stroke() {
    this.ctx.stroke()
  }
  fill() {
    this.ctx.fill()
  }
  arc(x: number, y: number, r: number, start: number, end: number) {
    this.ctx.arc(x, y, r, start, end)
  }
  fillText(text: string, x: number, y: number) {
    this.ctx.fillText(text, x, y)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.ctx.fillRect(x, y, w, h)
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.ctx.clearRect(x, y, w, h)
  }
  draw() {
    // 原生上下文立即生效，无需提交
  }
}

/**
 * 获取可绘制的画布上下文
 * @param canvasId 与 <Canvas id={canvasId}> 对应
 */
export function createChartContext(canvasId: string): ChartContext | null {
  if (process.env.TARO_ENV === 'h5') {
    if (typeof document === 'undefined') return null
    // 优先通过 id 找到 Taro 的包装元素，再取内层 canvas
    const wrapper = document.getElementById(canvasId)
    const el = (wrapper?.querySelector('canvas') ||
      document.querySelector(`canvas[canvas-id="${canvasId}"]`)) as HTMLCanvasElement | null
    if (!el) return null
    const ctx = el.getContext('2d')
    if (!ctx) return null

    // 按设备像素比设置后备缓冲区，保证高清屏清晰
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 3)
    const cssW = el.clientWidth || el.width
    const cssH = el.clientHeight || el.height
    if (cssW > 0 && cssH > 0) {
      el.width = Math.round(cssW * dpr)
      el.height = Math.round(cssH * dpr)
      ctx.scale(dpr, dpr)
    }
    return new NativeChartContext(ctx)
  }

  const ctx = Taro.createCanvasContext(canvasId)
  return new TaroChartContext(ctx)
}
