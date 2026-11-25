/**
 * 导出后端元数据 JSON
 *
 * 后端的「冲煮方式元数据」与「风味轮词库」直接来自前端 domain 层，
 * 这里用同一份 TS 源导出 JSON，避免两边手工维护导致漂移。
 *
 * 运行：npm run dump:metadata
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { BREW_METHODS } from '../src/domain/methods.ts'
import { FLAVOR_CATEGORIES, FLAVOR_DEFECTS } from '../src/domain/flavor.ts'

// 以当前工作目录为基准（项目根目录），保证无论从哪里执行都写到同一处
const seedDir = resolve(process.cwd(), 'backend/app/seed')

mkdirSync(seedDir, { recursive: true })

writeFileSync(resolve(seedDir, 'methods.json'), `${JSON.stringify(BREW_METHODS, null, 2)}\n`, 'utf-8')
writeFileSync(
  resolve(seedDir, 'flavor_wheel.json'),
  `${JSON.stringify(
    { version: 'SCA-2016-WCR', categories: FLAVOR_CATEGORIES, defects: FLAVOR_DEFECTS },
    null,
    2
  )}\n`,
  'utf-8'
)

console.log(`已导出 ${BREW_METHODS.length} 种冲煮方式 → backend/app/seed/methods.json`)
console.log(`已导出 ${FLAVOR_CATEGORIES.length} 个风味大类 → backend/app/seed/flavor_wheel.json`)
