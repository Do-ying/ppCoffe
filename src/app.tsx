import { PropsWithChildren } from 'react'
import { useLayoutEffect } from 'react'
import { useLaunch } from '@tarojs/taro'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './app.scss'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
})

/**
 * H5 端样式兜底。
 *
 * 主要修复放在 src/app.scss（静态 CSS），但 Taro 会在**构建期**把自己的
 * 基础样式注入到 index.html 的 <head> 末尾 —— 那里排在打包出的 <link>
 * 之后，所以静态 CSS 未必压得住某些规则。
 *
 * 这里再运行时注入一份作为兜底：
 * 运行时插入的 <style> 会排在 head 最末尾，优先级最高。
 *
 * 小程序端没有这些自定义元素，本段自动无副作用。
 */
const H5_PATCH_CSS = `
/* Taro H5 的 Input / Textarea 组件结构是：
 *   <taro-input-core class="form__input"><input class="weui-input"></taro-input-core>
 * 外层由 Taro 基础样式控制（height: 1.4rem; overflow: hidden），
 * 内层 weui-input 又有自己的 height: 1.47059em 且默认顶部对齐。
 * 两者不一致 → 表单里标签与输入框上下错位，
 * placeholder 也会跑到标签上一行。
 *
 * 让内层原生控件填满外层并继承字体，问题即消失。 */
taro-input-core > .weui-input,
taro-textarea-core > .taro-textarea {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  line-height: inherit !important;
  font-family: inherit !important;
  font-size: inherit !important;
  color: inherit !important;
  background: transparent !important;
  border: none !important;
  outline: none !important;
}

/* Taro H5 的页面容器 .taro_page 是 position: absolute; top: 0，
   而本项目每个页面都自带大标题（.page__title），
   所以 H5 端不需要 Taro 那条窄导航栏 —— 显示它反而会与页面标题重复。
   这里隐藏它，并给页面补上状态栏安全区留白，
   避免内容贴到屏幕最上方被 iOS 状态栏压住。 */
.taro-navigation-bar-hide,
.taro-navigation-bar-show {
  display: none !important;
}

.taro_page .page {
  padding-top: calc(env(safe-area-inset-top) + 12px) !important;
}
`

function useH5StylePatch() {
  useLayoutEffect(() => {
    // 小程序端没有 document / 自定义元素，无需补丁
    if (typeof document === 'undefined') return

    const PATCH_ID = 'ppcoffe-h5-patch'
    const inject = () => {
      let style = document.getElementById(PATCH_ID) as HTMLStyleElement | null
      if (!style) {
        style = document.createElement('style')
        style.id = PATCH_ID
        style.textContent = H5_PATCH_CSS
      }
      // 始终挂到 head 末尾 —— Taro 运行时注入的基础样式也在 head 里，
      // 同优先级下后插入的规则胜出，所以补丁必须排在它们之后
      if (style.parentNode !== document.head || style.nextSibling) {
        document.head.appendChild(style)
      }
    }

    inject()

    // Taro 的基础样式是运行时注入的，可能晚于本 effect；
    // 监听 head 变化，把补丁始终重新挪到末尾，确保它排在最后。
    const observer = new MutationObserver(() => inject())
    observer.observe(document.head, { childList: true })

    return () => observer.disconnect()
  }, [])
}

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log(
      '[ppCoffe] launched, api mode =',
      process.env.TARO_APP_API_MODE || 'mock'
    )
  })

  useH5StylePatch()

  // children 是将要会渲染的页面
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export default App
