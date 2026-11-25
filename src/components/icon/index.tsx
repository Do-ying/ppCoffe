import { View } from '@tarojs/components'

import './index.scss'

/**
 * 跨端线性图标。
 *
 * 计划书第六节要求首页使用「小尺寸线性图标，沿用现有主题色」。
 *
 * 为什么不用 SVG 或图片：
 *   - 微信小程序端不支持内联 SVG；
 *   - png 无法跟随主题色（深浅主题要两套图）。
 *
 * 为什么用真实子元素而不是 ::before / ::after：
 *   自定义元素（taro-view-core）上的伪元素在 H5 端不绘制 ——
 *   实测 DOM 里有 ::before，截图却是空白的。
 *   所以每个图标拆成 1–2 个真实 <View> 子元素画出来，
 *   H5 与小程序表现一致，颜色直接取 CSS 变量，自动跟随主题。
 *
 * ⚠️ 尺寸不能用行内 `rpx`：Taro H5 的行内样式不做 rpx→rem 转换，
 *    `style="width:28rpx"` 会被当作非法长度丢弃，元素塌成 0×0。
 *    统一走 CSS 变量 `--ico-size`（由 scss 里的 rem 值提供）。
 */

export type IconName =
  /** 咖啡杯 */
  | 'cup'
  /** 风味雷达 */
  | 'radar'
  /** 咖啡豆 */
  | 'bean'
  /** 记录（铅笔） */
  | 'record'
  /** 器具（扳手） */
  | 'tool'
  /** 烘焙（火焰） */
  | 'flame'
  /** 磨豆机 */
  | 'grinder'
  /** 豆仓（袋子） */
  | 'bag'
  /** 图片 */
  | 'image'

interface Props {
  name: IconName
  /** 尺寸（rpx），默认 28 */
  size?: number
  /** 颜色，默认跟随主题次要色 */
  color?: string
}

/** 每个图标的形状：1–2 个子元素的类名 */
const SHAPES: Record<IconName, string[]> = {
  // 咖啡杯：杯身 + 杯柄
  cup: ['ico__cup-body', 'ico__cup-handle'],
  // 风味雷达：外圈 + 内弧
  radar: ['ico__radar-outer', 'ico__radar-inner'],
  // 咖啡豆：豆形 + 中缝
  bean: ['ico__bean-body', 'ico__bean-seam'],
  // 记录：笔身 + 笔尖
  record: ['ico__record-body', 'ico__record-tip'],
  // 器具：手柄 + 头
  tool: ['ico__tool-handle', 'ico__tool-head'],
  // 烘焙：外焰 + 内焰
  flame: ['ico__flame-outer', 'ico__flame-inner'],
  // 磨豆机：料仓 + 底座
  grinder: ['ico__grinder-hopper', 'ico__grinder-base'],
  // 豆仓：袋身 + 封口
  bag: ['ico__bag-body', 'ico__bag-top'],
  // 图片：外框 + 太阳
  image: ['ico__image-frame', 'ico__image-dot']
}

/** 尺寸档位：rpx → CSS 类（scss 里用 rem 定义实际尺寸） */
const SIZE_CLASS: Record<number, string> = {
  22: 'ico--xs',
  24: 'ico--sm',
  26: 'ico--sm',
  28: 'ico--md',
  30: 'ico--md',
  34: 'ico--lg'
}

export default function Icon({ name, size = 28, color }: Props) {
  const shapes = SHAPES[name] ?? SHAPES.cup
  const sizeClass = SIZE_CLASS[size] ?? 'ico--md'
  return (
    <View className={`ico ico--${name} ${sizeClass}`} style={color ? { color } : undefined}>
      {shapes.map(cls => (
        <View key={cls} className={`ico__part ${cls}`} />
      ))}
    </View>
  )
}
