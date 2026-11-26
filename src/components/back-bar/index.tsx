import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'

import './index.scss'

/**
 * 页面返回条。
 *
 * 背景：本项目每个页面都自带大标题（.page__title），H5 端把 Taro 那条
 * 窄导航栏整体隐藏了（见 app.tsx 的 H5_PATCH_CSS），于是二级页面在 H5
 * 上没有任何「回上一层」的入口 —— 只能靠系统 / 浏览器的后退。
 * 这个组件补的就是那个入口。
 *
 * 只在 H5 渲染：小程序端的原生导航栏本身带返回箭头，
 * 再画一个就会出现两个返回键。
 */

/** tabBar 页面只能 switchTab 打开，navigateTo / redirectTo 都会失败 */
const TAB_PAGES = ['/pages/home/index', '/pages/brew/list/index', '/pages/bean/list/index']

interface Props {
  /** 按钮文案，默认「返回」 */
  label?: string
  /** 页面栈里没有上一页时的兜底去处，默认首页 */
  fallback?: string
}

export default function BackBar({ label = '返回', fallback = '/pages/home/index' }: Props) {
  if (process.env.TARO_ENV !== 'h5') return null

  const goBack = () => {
    const stack = Taro.getCurrentPages()
    // 正常路径：从上一页跳进来的，直接回退
    if (stack.length > 1) {
      void Taro.navigateBack({ delta: 1 })
      return
    }
    // 兜底：H5 刷新页面、或用分享链接直接打开二级页时没有上一页，
    // 退不回历史就给一个确定的落点，避免点了没反应。
    if (TAB_PAGES.includes(fallback)) {
      void Taro.switchTab({ url: fallback })
    } else {
      void Taro.redirectTo({ url: fallback })
    }
  }

  return (
    <View className="nav-back">
      <View
        className="nav-back__btn"
        hoverClass="nav-back__btn--hover"
        hoverStayTime={80}
        onClick={goBack}
      >
        <View className="nav-back__arrow" />
        <Text className="nav-back__label">{label}</Text>
      </View>
    </View>
  )
}
