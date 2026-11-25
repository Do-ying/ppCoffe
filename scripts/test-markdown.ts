/**
 * Markdown 解析器自测（纯函数，无需浏览器）。
 * 运行：npx esbuild scripts/test-markdown.ts --bundle --platform=node --format=esm --outfile=.test-md.mjs && node .test-md.mjs
 */
import { parseMarkdown, parseInline } from '../src/domain/markdown'

let pass = 0
let fail = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass += 1
    console.log(`  ✓ ${label}`)
  } else {
    fail += 1
    console.log(`  ✗ ${label}\n      实际: ${a}\n      期望: ${e}`)
  }
}

console.log('=== 行内语法 ===')
check('粗体', parseInline('**柑橘酸**'), [
  { type: 'bold', text: '柑橘酸' }
])
check('斜体', parseInline('*明亮*'), [
  { type: 'italic', text: '明亮' }
])
check('下划线斜体', parseInline('_偏短_'), [
  { type: 'italic', text: '偏短' }
])
check('代码', parseInline('用 `92℃` 冲'), [
  { type: 'text', text: '用 ' },
  { type: 'code', text: '92℃' },
  { type: 'text', text: ' 冲' }
])
check('混合', parseInline('**粗**和*斜*'), [
  { type: 'bold', text: '粗' },
  { type: 'text', text: '和' },
  { type: 'italic', text: '斜' }
])
check(
  'HTML 按文字显示',
  parseInline('<script>alert(1)</script>'),
  [{ type: 'text', text: '&lt;script&gt;alert(1)&lt;/script&gt;' }]
)

console.log('\n=== 块结构 ===')
const blocks = parseMarkdown(`# 标题一

这是 **粗体** 与 *斜体* 的段落。

## 标题二

- 第一项
- 第二项

1. 有序一
2. 有序二

> 引用内容

\`\`\`
代码块
\`\`\``)

check('块数量', blocks.length, 7)
check('第一个是标题', blocks[0].type, 'heading')
check('标题级别', (blocks[0] as any).level, 1)
check('段落类型', blocks[1].type, 'paragraph')
check('二级标题', (blocks[2] as any).level, 2)
check('无序列表', (blocks[3] as any).ordered, false)
check('列表项数', (blocks[3] as any).items.length, 2)
check('有序列表', (blocks[4] as any).ordered, true)
check('引用', blocks[5].type, 'quote')
check('代码块', blocks[6].type, 'code-block')
check('代码块内容', (blocks[6] as any).text, '代码块')

console.log('\n=== 边界 ===')
check('空输入', parseMarkdown('').length, 0)
check('null 输入', parseMarkdown(null).length, 0)
check('纯空白', parseMarkdown('   \n  ').length, 0)
check('单行段落', parseMarkdown('一句话').length, 1)
check(
  '段落内换行合并',
  parseMarkdown('第一行\n第二行').length,
  1
)

console.log(`\n${pass} 项通过，${fail} 项失败`)
if (fail > 0) process.exit(1)
