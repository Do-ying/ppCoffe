/**
 * 极简 Markdown 解析（首版支持集）。
 *
 * 计划书第四节要求支持：标题、粗体、斜体、有序和无序列表、引用、段落换行。
 * 另有一条硬约束：**原始 HTML 按文字显示** —— 不做任何 HTML 解析，
 * 避免 XSS；遇到 `<` 会被转义成文本。
 *
 * 设计取舍：不用第三方 Markdown 库。
 *   - 微信小程序端没有 DOM，HTML 渲染类库大多不可用；
 *   - 本项目只要 6 种语法，自己解析更可控也更好测。
 *
 * 输出是**结构化的块数组**（而不是 HTML 字符串），
 * 由渲染组件转成 Taro 组件树 —— 这样 H5 与小程序表现完全一致。
 */

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'code'; text: string }

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'quote'; inline: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'code-block'; text: string }

/** 转义 HTML 特殊字符 —— 原始 HTML 按文字显示，不解析 */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * 解析行内语法：**粗体**、*斜体*、`代码`。
 *
 * 单遍分词：用一个组合正则依次匹配三种语法，扫到的就是节点本身，
 * 不用占位符回填（那样容易与原文位置错位）。
 */
export function parseInline(raw: string): InlineNode[] {
  if (!raw) return []

  const pattern =
    /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\s][^_\n]*)_/g
  const nodes: InlineNode[] = []
  let last = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(raw)) !== null) {
    if (m.index > last) {
      nodes.push({ type: 'text', text: escapeText(raw.slice(last, m.index)) })
    }

    if (m[1] !== undefined) {
      nodes.push({ type: 'code', text: m[1] })
    } else if (m[2] !== undefined) {
      nodes.push({ type: 'bold', text: m[2] })
    } else if (m[3] !== undefined) {
      nodes.push({ type: 'bold', text: m[3] })
    } else if (m[4] !== undefined) {
      nodes.push({ type: 'italic', text: m[4] })
    } else if (m[5] !== undefined) {
      nodes.push({ type: 'italic', text: m[5] })
    }
    last = m.index + m[0].length
  }

  if (last < raw.length) {
    nodes.push({ type: 'text', text: escapeText(raw.slice(last)) })
  }

  return nodes.length ? nodes : [{ type: 'text', text: '' }]
}

/** 解析整篇 Markdown 为块数组。 */
export function parseMarkdown(source?: string | null): BlockNode[] {
  if (!source || !source.trim()) return []

  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: BlockNode[] = []
  let i = 0

  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (!trimmed) {
      i += 1
      continue
    }

    // 代码块 ```
    if (trimmed.startsWith('```')) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ type: 'code-block', text: buf.join('\n') })
      continue
    }

    // 标题 # ## ###
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, inline: parseInline(heading[2]) })
      i += 1
      continue
    }

    // 引用 >
    if (trimmed.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'quote', inline: parseInline(buf.join(' ')) })
      continue
    }

    // 列表 - * 或 1.
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) {
      const first = /^([-*]|\d+\.)\s+/.exec(trimmed)
      const ordered = /\d/.test(first ? first[1] : '')
      const items: InlineNode[][] = []
      while (i < lines.length) {
        const m = /^([-*]|\d+\.)\s+(.*)$/.exec(lines[i].trim())
        if (!m) break
        items.push(parseInline(m[2]))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // 段落：连续非空行合并（行内换行视为同一段）
    const buf: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      if (
        !t ||
        /^(#{1,3})\s+/.test(t) ||
        t.startsWith('>') ||
        /^([-*]|\d+\.)\s+/.test(t) ||
        t.startsWith('```')
      ) {
        break
      }
      buf.push(t)
      i += 1
    }
    blocks.push({ type: 'paragraph', inline: parseInline(buf.join(' ')) })
  }

  return blocks
}
