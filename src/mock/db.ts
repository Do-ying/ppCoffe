import type {
  Bean,
  BrewImage,
  BrewRecord,
  BrewCurve,
  Equipment,
  FlavorProfile,
  RoastBatch
} from '../domain/types'
import { BREW_METHODS } from '../domain/methods'
import { generatePlanCurve } from '../domain/curve/generate'
import { generateRoastCurve } from '../domain/curve/roast'
import type { RequestOptions, Transport } from '../services/http'

/**
 * Mock 内存数据库与传输层
 *
 * 实现 docs/02-接口契约.md 中定义的全部端点语义（列表筛选、CRUD、派生曲线、对比、诊断），
 * 让前端在后端就绪前也能跑通完整业务闭环。
 */

const now = () => new Date().toISOString()

/* ---------------------------------- fixtures ---------------------------------- */

const beanFixtures: Bean[] = [
  {
    id: 'bn_eth_01',
    name: '耶加雪菲 · 科契尔 水洗 G1',
    roaster: '几何咖啡',
    origin: { country: '埃塞俄比亚', region: 'Sidama', farm: 'Kochere', altitudeMasl: 1950, variety: '74158' },
    process: 'washed',
    roastLevel: 'light',
    agtron: 62,
    roastDate: '2026-11-10',
    weightGrams: 200,
    remainingGrams: 120,
    tags: ['花果香'],
    notes: '柑橘与白桃，尾段有红茶感',
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z'
  },
  {
    id: 'bn_col_02',
    name: '哥伦比亚 · 慧兰 慢速日晒',
    roaster: '乔治队长',
    origin: { country: '哥伦比亚', region: 'Huila', farm: 'El Diviso', altitudeMasl: 1800 },
    process: 'natural',
    roastLevel: 'medium',
    roastDate: '2026-11-16',
    weightGrams: 250,
    remainingGrams: 250,
    tags: ['莓果'],
    notes: '发酵感莓果，焦糖甜感明显',
    createdAt: '2026-11-16T08:00:00Z',
    updatedAt: '2026-11-16T08:00:00Z'
  },
  {
    id: 'bn_br_03',
    name: '巴西 · 喜拉多 拼配',
    roaster: '自有烘焙',
    origin: { country: '巴西', region: 'Minas Gerais' },
    process: 'washed',
    roastLevel: 'medium_dark',
    roastDate: '2026-11-05',
    weightGrams: 500,
    remainingGrams: 80,
    tags: ['意式'],
    notes: '用于意式，坚果与可可为主',
    createdAt: '2026-11-05T06:00:00Z',
    updatedAt: '2026-11-05T06:00:00Z'
  }
]

function flavor(
  axes: FlavorProfile['axes'],
  descriptors: FlavorProfile['descriptors'] = [],
  note = ''
): FlavorProfile {
  return {
    axes,
    descriptors,
    defects: [],
    tempStage: 'warm',
    overall: Number(((axes.acidity + axes.sweetness + axes.body + axes.flavor + axes.aftertaste + axes.balance) / 6).toFixed(1)),
    note
  }
}

function buildBrew(
  id: string,
  beanId: string,
  methodId: string,
  dose: number,
  water: number,
  seconds: number,
  temp: number,
  axes: FlavorProfile['axes'],
  note: string,
  daysAgo: number
): BrewRecord {
  const method = BREW_METHODS.find(m => m.id === methodId)!
  const steps = method.defaultSteps
  const curve: BrewCurve = generatePlanCurve(steps, seconds)
  const date = new Date(Date.now() - daysAgo * 86400000)
  return {
    id,
    beanId,
    method: methodId,
    params: {
      doseGrams: dose,
      waterGrams: water,
      yieldGrams: Math.round(water * 0.9),
      brewSeconds: seconds,
      temperature: temp,
      preinfusionSeconds: method.params.preinfusionSeconds?.default,
      ratio: Number((water / dose).toFixed(2))
    },
    steps,
    curve,
    flavor: flavor(axes, [], note),
    notes: note,
    brewDate: date.toISOString(),
    createdAt: date.toISOString(),
    updatedAt: date.toISOString()
  }
}

const brewFixtures: BrewRecord[] = [
  buildBrew(
    'br_001',
    'bn_eth_01',
    'pour_over_v60',
    15,
    250,
    168,
    93,
    { acidity: 8, sweetness: 4, body: 4, flavor: 7, aftertaste: 4, balance: 5 },
    '前段有明显柑橘酸，尾段发苦，余韵偏短',
    2
  ),
  buildBrew(
    'br_002',
    'bn_eth_01',
    'pour_over_v60',
    15,
    260,
    155,
    94,
    { acidity: 6, sweetness: 7, body: 4, flavor: 8, aftertaste: 7, balance: 7 },
    '磨细一格后甜感上来了，柑橘与白桃',
    1
  ),
  buildBrew(
    'br_003',
    'bn_br_03',
    'espresso',
    18,
    40,
    29,
    93,
    { acidity: 4, sweetness: 6, body: 8, flavor: 6, aftertaste: 6, balance: 7 },
    '坚果与可可，crema 厚实',
    1
  ),
  buildBrew(
    'br_004',
    'bn_col_02',
    'french_press',
    15,
    250,
    240,
    91,
    { acidity: 3, sweetness: 7, body: 8, flavor: 5, aftertaste: 6, balance: 5 },
    '醇厚带油，莓果甜感好',
    3
  )
]

const roastFixtures: RoastBatch[] = [
  {
    id: 'rb_001',
    beanId: 'bn_eth_01',
    batchNo: '2026-1110-A',
    roaster: 'Aillio Bullet R2',
    greenGrams: 500,
    outGrams: 425,
    weightLossPercent: 15,
    totalSeconds: 512,
    events: [
      { type: 'charge', atSecond: 0, temperature: 205 },
      { type: 'turningPoint', atSecond: 78, temperature: 108 },
      { type: 'dryEnd', atSecond: 240, temperature: 158 },
      { type: 'firstCrack', atSecond: 348, temperature: 201 },
      { type: 'drop', atSecond: 512, temperature: 216 }
    ],
    dtrPercent: 32,
    phaseRatio: { drying: 46.9, maillard: 21.1, development: 32 },
    cuppingScore: 86.5,
    notes: '梅纳期偏长，发展比略高，甜感好但酸质略钝',
    roastDate: '2026-11-10T09:00:00Z'
  }
]

/* ---------------------------------- 器具 ---------------------------------- */

const equipmentFixtures: Equipment[] = [
  {
    id: 'eq_grinder_ek43',
    type: 'grinder',
    name: 'EK43',
    brand: 'Fellow',
    model: 'EK43 S',
    notes: '#22 约 0.8mm，粗细以刻度计',
    createdAt: '2026-09-01T02:00:00Z'
  },
  {
    id: 'eq_grinder_rosso',
    type: 'grinder',
    name: 'Rosso 绞磨',
    brand: 'Home',
    model: 'Rosso R2',
    notes: '刻度 0-40，越大越细',
    createdAt: '2026-09-02T02:00:00Z'
  },
  {
    id: 'eq_dripper_v60',
    type: 'dripper',
    name: 'V60 02 滤杯',
    brand: 'Hario',
    model: '02 陶瓷',
    createdAt: '2026-09-03T02:00:00Z'
  },
  {
    id: 'eq_dripper_kalita',
    type: 'dripper',
    name: 'Kalita Wave 185',
    brand: 'Kalita',
    model: 'Wave 185 灰',
    createdAt: '2026-09-03T02:00:00Z'
  },
  {
    id: 'eq_brewer_kettle',
    type: 'brewer',
    name: '细口手冲壶',
    brand: 'Fellow',
    model: 'Stagg EKG',
    notes: '控温 92℃',
    createdAt: '2026-09-04T02:00:00Z'
  },
  {
    id: 'eq_scale',
    type: 'scale',
    name: '电子秤',
    brand: 'TIMEMORE',
    model: 'Black Series',
    notes: '0.1g 精度，蓝牙连接',
    createdAt: '2026-09-05T02:00:00Z'
  },
  {
    id: 'eq_espresso_machine',
    type: 'espresso',
    name: '半自动咖啡机',
    brand: 'ECM',
    model: 'Synchronika',
    notes: 'E61 冲煮头，58mm 粉碗',
    createdAt: '2026-09-06T02:00:00Z'
  },
  {
    id: 'eq_roaster',
    type: 'roaster',
    name: '烘豆机',
    brand: 'Aillio',
    model: 'Bullet R2',
    createdAt: '2026-09-07T02:00:00Z'
  }
]

/* ---------------------------------- mock db ---------------------------------- */

interface MockDb {
  beans: Bean[]
  brews: BrewRecord[]
  roasts: RoastBatch[]
  equipment: Equipment[]
  uploads: BrewImage[]
}

const db: MockDb = {
  beans: [...beanFixtures],
  brews: [...brewFixtures],
  roasts: roastFixtures.map(r => ({ ...r, curve: generateRoastCurve(r.events, r.totalSeconds) })),
  equipment: [...equipmentFixtures],
  uploads: []
}

let seq = 100
const nextId = (prefix: string) => `${prefix}_${String(++seq).padStart(4, '0')}`

function matches(brew: BrewRecord, params: RequestOptions['params']) {
  if (!params) return true
  if (params.method && brew.method !== params.method) return false
  if (params.beanId && brew.beanId !== params.beanId) return false
  if (params.from && brew.brewDate < String(params.from)) return false
  if (params.to && brew.brewDate > String(params.to)) return false
  return true
}

function notFound(what: string): never {
  throw Object.assign(new Error(`${what}不存在`), {
    code: 'NOT_FOUND',
    message: `${what}不存在`
  })
}

/** Mock 传输层：按路径分发到内存 DB */
export const mockTransport: Transport = {
  async request<T>(options: RequestOptions): Promise<T> {
    const { method = 'GET', url, data, params } = options
    const body = (data ?? {}) as Record<string, any>

    // 元数据
    if (url === '/methods') {
      return { items: BREW_METHODS } as T
    }

    if (url === '/flavor-wheel') {
      // 词库由 domain/flavor 提供，mock 端直接返回本地常量
      const { FLAVOR_CATEGORIES, FLAVOR_DEFECTS } = require('../domain/flavor')
      return { version: 'SCA-2016-WCR', categories: FLAVOR_CATEGORIES, defects: FLAVOR_DEFECTS } as T
    }

    // 豆子
    if (url === '/beans' && method === 'GET') {
      return { items: db.beans } as T
    }
    if (url === '/beans' && method === 'POST') {
      const bean = {
        ...body,
        id: nextId('bn'),
        createdAt: now(),
        updatedAt: now()
      } as Bean
      db.beans.unshift(bean)
      return bean as T
    }
    if (url.startsWith('/beans/') && method === 'GET') {
      const id = url.split('/')[2]
      const bean = db.beans.find(b => b.id === id)
      if (!bean) notFound('豆子')
      return bean as T
    }
    if (url.startsWith('/beans/') && method === 'PATCH') {
      const id = url.split('/')[2]
      const idx = db.beans.findIndex(b => b.id === id)
      if (idx < 0) notFound('豆子')
      db.beans[idx] = { ...db.beans[idx], ...body, updatedAt: now() }
      return db.beans[idx] as T
    }
    if (url.startsWith('/beans/') && url.endsWith('/brews')) {
      const id = url.split('/')[2]
      return { items: db.brews.filter(b => b.beanId === id) } as T
    }
    if (url.startsWith('/beans/') && url.endsWith('/roasts')) {
      const id = url.split('/')[2]
      return { items: db.roasts.filter(r => r.beanId === id) } as T
    }

    // 冲煮
    if (url === '/brews' && method === 'GET') {
      const list = db.brews.filter(b => matches(b, params))
      return { items: list } as T
    }
    if (url === '/brews' && method === 'POST') {
      const brew = {
        ...body,
        id: nextId('br'),
        createdAt: now(),
        updatedAt: now()
      } as BrewRecord
      db.brews.unshift(brew)
      return brew as T
    }
    if (url === '/brews/derive-curve' && method === 'POST') {
      const methodMeta = BREW_METHODS.find(m => m.id === body.method)
      if (!methodMeta) notFound('冲煮方式')
      const steps = body.steps?.length ? body.steps : methodMeta.defaultSteps
      const curve = generatePlanCurve(steps, body.params?.brewSeconds ?? 180)
      return { points: curve.points, stages: curve.stages, meta: { generator: 'mock-plan-v1' } } as T
    }
    if (url === '/brews/compare' && method === 'POST') {
      const ids: string[] = body.brewIds || []
      const brews = db.brews.filter(b => ids.includes(b.id))
      return {
        brews,
        paramDiff: [],
        flavorDiff: [],
        curves: brews.map(b => ({ id: b.id, points: b.curve.points }))
      } as T
    }
    if (url.startsWith('/brews/') && url.endsWith('/diagnosis') && method === 'GET') {
      const id = url.split('/')[2]
      const brew = db.brews.find(b => b.id === id)
      if (!brew) notFound('冲煮记录')
      const { diagnose } = require('../domain/diagnosis')
      const { METHOD_MAP } = require('../domain/methods')
      return diagnose(METHOD_MAP[brew.method], brew.flavor) as T
    }
    if (url.startsWith('/brews/') && method === 'GET') {
      const id = url.split('/')[2]
      const brew = db.brews.find(b => b.id === id)
      if (!brew) notFound('冲煮记录')
      return brew as T
    }
    if (url.startsWith('/brews/') && method === 'PATCH') {
      const id = url.split('/')[2]
      const idx = db.brews.findIndex(b => b.id === id)
      if (idx < 0) notFound('冲煮记录')
      db.brews[idx] = { ...db.brews[idx], ...body, updatedAt: now() }
      return db.brews[idx] as T
    }
    if (url.startsWith('/brews/') && method === 'DELETE') {
      const id = url.split('/')[2]
      const idx = db.brews.findIndex(b => b.id === id)
      if (idx < 0) notFound('冲煮记录')
      db.brews.splice(idx, 1)
      return { ok: true } as T
    }

    // 烘豆
    if (url === '/roasts' && method === 'GET') {
      return { items: db.roasts } as T
    }
    if (url === '/roasts' && method === 'POST') {
      const roast = { ...body, id: nextId('rb') } as RoastBatch
      db.roasts.unshift(roast)
      return roast as T
    }
    if (url.startsWith('/roasts/') && method === 'GET') {
      const id = url.split('/')[2]
      const roast = db.roasts.find(r => r.id === id)
      if (!roast) notFound('烘焙批次')
      return roast as T
    }

    // 器具
    if (url === '/equipment' && method === 'GET') {
      return { items: db.equipment } as T
    }
    if (url === '/equipment' && method === 'POST') {
      const equipment = {
        ...body,
        id: nextId('eq'),
        createdAt: now()
      } as Equipment
      db.equipment.push(equipment)
      return equipment as T
    }
    if (url.startsWith('/equipment/') && method === 'PATCH') {
      const id = url.split('/')[2]
      const idx = db.equipment.findIndex(e => e.id === id)
      if (idx < 0) notFound('器具')
      db.equipment[idx] = { ...db.equipment[idx], ...body }
      return db.equipment[idx] as T
    }
    if (url.startsWith('/equipment/') && method === 'DELETE') {
      const id = url.split('/')[2]
      const idx = db.equipment.findIndex(e => e.id === id)
      if (idx < 0) notFound('器具')
      db.equipment.splice(idx, 1)
      return { ok: true } as T
    }

    /* ---- 图片上传（Mock：后端直传协议在本地模拟，真实模式由后端对接对象存储） ---- */
    if (url === '/uploads/presign' && method === 'POST') {
      const objectKey = body.filename || `brew/${Date.now()}.jpg`
      return {
        objectKey,
        uploadUrl: '',
        publicUrl: '',
        headers: {}
      } as T
    }
    if (url === '/uploads' && method === 'POST') {
      const dataUri = body.dataUri as string
      const image: BrewImage = {
        id: nextId('img'),
        objectKey: (body.filename as string) || `brew/${Date.now()}.jpg`,
        url: dataUri,
        sizeBytes: (body.sizeBytes as number) || 0
      }
      db.uploads.push(image)
      return image as T
    }
    if (url === '/uploads' && method === 'DELETE') {
      const key = params?.objectKey as string | undefined
      db.uploads = db.uploads.filter(u => u.objectKey !== key)
      return { ok: true } as T
    }

    // 统计
    if (url === '/stats/summary') {
      const today = now().slice(0, 10)
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const weekBrews = db.brews.filter(b => b.brewDate >= weekAgo)
      const avg = weekBrews.length
        ? weekBrews.reduce((s, b) => s + b.flavor.overall, 0) / weekBrews.length
        : 0
      const byMethod: Record<string, number> = {}
      weekBrews.forEach(b => {
        byMethod[b.method] = (byMethod[b.method] || 0) + 1
      })
      return {
        today: {
          brewCount: db.brews.filter(b => b.brewDate.slice(0, 10) === today).length,
          roastCount: 0,
          avgFlavor: Number(avg.toFixed(1))
        },
        week: { brewCount: weekBrews.length, avgFlavor: Number(avg.toFixed(1)), byMethod },
        restingBeans: db.beans.map(b => {
          const days = Math.floor(
            (Date.now() - new Date(b.roastDate).getTime()) / 86400000
          )
          return {
            beanId: b.id,
            name: b.name,
            roastDate: b.roastDate,
            daysSinceRoast: days,
            stage: days < 7 ? 'resting' : days <= 21 ? 'peak' : 'fading'
          }
        }),
        activeSession: null
      } as T
    }

    throw Object.assign(new Error(`Mock 未实现该端点：${method} ${url}`), {
      code: 'NOT_IMPLEMENTED',
      message: `Mock 未实现该端点：${method} ${url}`
    })
  }
}
