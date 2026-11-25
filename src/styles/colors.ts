import type { ResolvedTheme } from '../store/useTheme'

/**
 * Canvas 绘图配色
 *
 * Canvas API 读不到 CSS 变量，所以这里维护一份与 themes.scss 对应的调色板，
 * 运行时按当前主题取用，保证图表在浅色下依然清晰。
 */

export interface ChartPalette {
  line: string
  lineStrong: string
  text: string
  textDim: string
  textMute: string
  signal: string
  amber: string
  danger: string
  ok: string
  stage: Record<string, string>
  axis: string[]
}

const DARK: ChartPalette = {
  line: '#2a302d',
  lineStrong: '#3a423e',
  text: '#e8ede8',
  textDim: '#9ba59e',
  textMute: '#69726c',
  signal: '#7fd1c1',
  amber: '#e9b44c',
  danger: '#e0604e',
  ok: '#8fcb6b',
  stage: {
    preinfusion: '#6c9bd1',
    bloom: '#7fd1c1',
    extraction: '#5fa8a0',
    drawdown: '#e9b44c'
  },
  axis: ['#7fd1c1', '#e9b44c', '#6c9bd1', '#c98fd1', '#8fcb6b', '#d1a37f']
}

const LIGHT: ChartPalette = {
  line: '#dde2de',
  lineStrong: '#c3cac5',
  text: '#171a18',
  textDim: '#55605a',
  textMute: '#838d87',
  signal: '#0e8a78',
  amber: '#a8710a',
  danger: '#c0392b',
  ok: '#3f7f31',
  stage: {
    preinfusion: '#3b6fa8',
    bloom: '#0e8a78',
    extraction: '#2a7f73',
    drawdown: '#a8710a'
  },
  axis: ['#0e8a78', '#a8710a', '#3b6fa8', '#8b4fa0', '#3f7f31', '#a8703f']
}

export function chartPalette(theme: ResolvedTheme): ChartPalette {
  return theme === 'light' ? LIGHT : DARK
}
