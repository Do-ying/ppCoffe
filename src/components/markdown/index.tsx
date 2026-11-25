import { View, Text } from '@tarojs/components'
import { useMemo } from 'react'

import { parseMarkdown, type BlockNode, type InlineNode } from '../../domain/markdown'

import './index.scss'

/**
 * 跨端 Markdown 渲染组件。
 *
 * 计划书第四节：「两个区块复用一个跨端 Markdown 渲染组件，在 H5 和微信小程序
 * 遵循相同格式，空白字段隐藏，旧的纯文本照常显示。渲染只生成受支持的节点，
 * 原始 HTML 按文字显示。」
 *
 * 实现要点：
 *   - 只用 Taro 的 View / Text，不碰 DOM —— 小程序端无 DOM
 *   - 解析结果转成组件树，不生成 HTML 字符串 —— 天然避免 XSS
 *   - 空白输入直接不渲染任何内容
 */

interface Props {
  /** Markdown 原文；为空或纯空白时不渲染 */
  source?: string | null
  /** 紧凑模式：用于预览页的窄区块 */
  compact?: boolean
}

/** 行内节点 → Taro 组件 */
function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'bold') {
          return (
            <Text key={i} className="md__bold">
              {n.text}
            </Text>
          )
        }
        if (n.type === 'italic') {
          return (
            <Text key={i} className="md__italic">
              {n.text}
            </Text>
          )
        }
        if (n.type === 'code') {
          return (
            <Text key={i} className="md__code">
              {n.text}
            </Text>
          )
        }
        return (
          <Text key={i} className="md__text">
            {n.text}
          </Text>
        )
      })}
    </>
  )
}

/** 块节点 → Taro 组件 */
function Block({ block }: { block: BlockNode }) {
  if (block.type === 'heading') {
    return (
      <View className={`md__h md__h${block.level}`}>
        <Inline nodes={block.inline} />
      </View>
    )
  }

  if (block.type === 'quote') {
    return (
      <View className="md__quote">
        <Inline nodes={block.inline} />
      </View>
    )
  }

  if (block.type === 'list') {
    return (
      <View className="md__list">
        {block.items.map((item, i) => (
          <View className="md__item" key={i}>
            <Text className="md__marker">{block.ordered ? `${i + 1}.` : '·'}</Text>
            <View className="md__item-body">
              <Inline nodes={item} />
            </View>
          </View>
        ))}
      </View>
    )
  }

  if (block.type === 'code-block') {
    return (
      <View className="md__codeblock">
        <Text>{block.text}</Text>
      </View>
    )
  }

  return (
    <View className="md__p">
      <Inline nodes={block.inline} />
    </View>
  )
}

export default function Markdown({ source, compact }: Props) {
  const blocks = useMemo(() => parseMarkdown(source), [source])

  // 空白字段隐藏
  if (!blocks.length) return null

  return (
    <View className={compact ? 'md md--compact' : 'md'}>
      {blocks.map((block, i) => (
        <Block block={block} key={i} />
      ))}
    </View>
  )
}
