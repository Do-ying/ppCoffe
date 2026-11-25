import { create } from 'zustand'
import Taro from '@tarojs/taro'
import { useEffect } from 'react'

/**
 * 主题状态
 *
 * 三种模式：深色（默认）/ 浅色 / 跟随系统。
 * 颜色本身全部落在 CSS 变量里（styles/themes.scss），切换只换变量值。
 * 主题解析结果会落到具体主题（dark | light），再分发给：
 *   H5      —— <html data-theme="...">
 *   小程序   —— 页面根节点的 .theme-* 类 + setBackgroundColor
 */

export type ThemeMode = 'dark' | 'light' | 'auto'
export type ResolvedTheme = 'dark' | 'light'

const STORAGE_KEY = 'ppcoffe.theme'

/** 与 themes.scss 中的 --bg 保持一致，用于小程序端设置页面背景 */
export const THEME_BG: Record<ResolvedTheme, string> = {
  dark: '#0d0f0e',
  light: '#f2f4f2'
}

/** TabBar 配色（原生 TabBar 不吃 CSS 变量，需用 API 同步） */
const TABBAR_STYLE: Record<ResolvedTheme, Record<string, string>> = {
  dark: {
    color: '#69726c',
    selectedColor: '#7fd1c1',
    backgroundColor: '#151817',
    borderStyle: 'black'
  },
  light: {
    color: '#838d87',
    selectedColor: '#0e8a78',
    backgroundColor: '#ffffff',
    borderStyle: 'white'
  }
}

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  dark: '深色',
  light: '浅色',
  auto: '跟随系统'
}

export const THEME_MODE_HINTS: Record<ThemeMode, string> = {
  dark: '炭墨底 + 仪表荧光青',
  light: '冷灰白纸感 + 深墨字',
  auto: '随系统深浅色自动切换'
}

function detectSystemTheme(): ResolvedTheme {
  try {
    if (process.env.TARO_ENV === 'h5') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      return 'dark'
    }
    const info = Taro.getSystemInfoSync() as { theme?: string }
    return info.theme === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(resolved: ResolvedTheme) {
  if (process.env.TARO_ENV === 'h5') {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolved)
    }
  } else {
    try {
      Taro.setBackgroundColor({
        backgroundColorTop: THEME_BG[resolved],
        backgroundColorBottom: THEME_BG[resolved]
      })
    } catch {
      /* 忽略平台不支持的情况 */
    }
  }

  // 原生 TabBar 不受 CSS 变量控制，需要用 API 同步配色
  try {
    Taro.setTabBarStyle(TABBAR_STYLE[resolved] as never)
  } catch {
    /* 非 TabBar 页面调用会失败，忽略即可 */
  }
}

interface ThemeState {
  mode: ThemeMode
  system: ResolvedTheme
  resolved: ResolvedTheme
  /** 初始化：读取持久化设置 + 检测系统主题 + 订阅系统主题变化 */
  init: () => () => void
  setMode: (mode: ThemeMode) => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: 'dark',
  system: 'dark',
  resolved: 'dark',

  init: () => {
    let mode: ThemeMode = 'dark'
    try {
      const saved = Taro.getStorageSync(STORAGE_KEY) as ThemeMode
      if (saved === 'dark' || saved === 'light' || saved === 'auto') mode = saved
    } catch {
      /* 忽略存储异常 */
    }

    const system = detectSystemTheme()
    const resolved = mode === 'auto' ? system : mode
    set({ mode, system, resolved })
    applyTheme(resolved)

    // 订阅系统主题变化（仅「跟随系统」模式下有意义）
    let media: MediaQueryList | undefined
    const onSystemChange = (next: ResolvedTheme) => {
      set({ system: next })
      if (get().mode === 'auto') {
        set({ resolved: next })
        applyTheme(next)
      }
    }

    if (process.env.TARO_ENV === 'h5') {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        media = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = (e: MediaQueryListEvent) => onSystemChange(e.matches ? 'dark' : 'light')
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', handler)
        } else if (typeof (media as any).addListener === 'function') {
          ;(media as any).addListener(handler)
        }
      }
    } else {
      try {
        Taro.onThemeChange(({ theme }) => onSystemChange(theme === 'light' ? 'light' : 'dark'))
      } catch {
        /* 平台不支持则忽略 */
      }
    }

    return () => {
      if (media && typeof (media as any).removeEventListener === 'function') {
        ;(media as any).removeEventListener('change', () => {})
      }
    }
  },

  setMode: (mode: ThemeMode) => {
    try {
      Taro.setStorageSync(STORAGE_KEY, mode)
    } catch {
      /* 忽略存储异常 */
    }
    const system = get().system
    const resolved = mode === 'auto' ? system : mode
    set({ mode, resolved })
    applyTheme(resolved)
  }
}))

/**
 * 页面使用的当前主题
 * @returns resolved 主题（始终是具体的 dark / light）与可直接挂在根节点的类名
 */
export function useResolvedTheme(): { theme: ResolvedTheme; themeClass: string } {
  const init = useTheme(s => s.init)
  const resolved = useTheme(s => s.resolved)

  useEffect(() => {
    const cleanup = init()
    return cleanup
  }, [init])

  return { theme: resolved, themeClass: `theme-${resolved}` }
}
