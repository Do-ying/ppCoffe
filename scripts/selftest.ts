/**
 * domain 层自检脚本
 *
 * domain/ 是纯函数层（无 Taro / React 依赖），可以直接在 Node 里跑。
 * 运行：node scripts/selftest.mjs（或 npm run selftest）
 */

import assert from 'node:assert'
import { BREW_METHODS, METHOD_MAP, calcRatio, validateParams } from '../src/domain/methods.ts'
import { generatePlanCurve, generateKeypointCurve, computeFlow, curveStats } from '../src/domain/curve/generate.ts'
import { computeRoR, computeDTR, computePhaseRatio, computeWeightLoss, parseArtisanAlog } from '../src/domain/curve/roast.ts'
import { diagnose } from '../src/domain/diagnosis/index.ts'
import { matchScore, axesDelta } from '../src/domain/flavor.ts'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
    process.exitCode = 1
  }
}

console.log('\n[1] 冲煮方式元数据')

test('11 种冲煮方式全部具备必要字段', () => {
  assert.strictEqual(BREW_METHODS.length, 11)
  BREW_METHODS.forEach(m => {
    assert.ok(m.name, `${m.id} 缺少名称`)
    assert.ok(m.grindHint, `${m.id} 缺少研磨提示`)
    assert.ok(m.flavorBaseline, `${m.id} 缺少风味基线`)
    assert.ok(m.defaultSteps.length >= 2, `${m.id} 缺少注水计划`)
    Object.values(m.flavorBaseline).forEach(v => {
      assert.ok(v >= 0 && v <= 10, `${m.id} 基线值越界: ${v}`)
    })
  })
})

test('方式 id 唯一', () => {
  const ids = BREW_METHODS.map(m => m.id)
  assert.strictEqual(new Set(ids).size, ids.length)
})

test('粉水比按方式落在建议区间内', () => {
  const v60 = METHOD_MAP['pour_over_v60']
  const ratio = calcRatio({ doseGrams: 15, waterGrams: 250 })
  assert.strictEqual(ratio, 16.67)
  assert.ok(ratio >= v60.params.ratio.range[0] && ratio <= v60.params.ratio.range[1])
})

test('越界参数能被检出', () => {
  const issues = validateParams('pour_over_v60', { temperature: 60 })
  assert.ok(issues.some(i => i.field === 'temperature'))
})

console.log('\n[2] 曲线生成')

test('plan 曲线：重量单调不减，终点等于目标水量', () => {
  const m = METHOD_MAP['pour_over_v60']
  const curve = generatePlanCurve(m.defaultSteps, 165)
  assert.ok(curve.points.length > 100, '采样点过少')
  for (let i = 1; i < curve.points.length; i++) {
    assert.ok(
      curve.points[i].w >= curve.points[i - 1].w - 0.01,
      `第 ${i} 点重量下降: ${curve.points[i - 1].w} → ${curve.points[i].w}`
    )
  }
  const last = curve.points[curve.points.length - 1]
  assert.ok(Math.abs(last.w - 250) < 1, `终点重量 ${last.w} 不等于 250`)
  assert.strictEqual(last.t, 165)
})

test('plan 曲线：阶段区间正确覆盖时间轴', () => {
  const m = METHOD_MAP['pour_over_v60']
  const curve = generatePlanCurve(m.defaultSteps, 165)
  assert.ok(curve.stages.length >= 3)
  assert.strictEqual(curve.stages[0].stage, 'bloom')
  assert.strictEqual(curve.stages[0].from, 0)
  const bloomPoints = curve.points.filter(p => p.stage === 'bloom')
  assert.ok(bloomPoints.length > 0, '闷蒸段没有点')
})

test('瞬时流速：结束点为 0，峰值出现在注水阶段', () => {
  const m = METHOD_MAP['pour_over_v60']
  const curve = generatePlanCurve(m.defaultSteps, 165)
  const stats = curveStats(curve)
  assert.strictEqual(stats.duration, 165)
  assert.ok(stats.peakFlow > 0, '峰值流速应为正')
  const last = curve.points[curve.points.length - 1]
  assert.ok(last.flow < 0.5, `结束流速 ${last.flow} 应接近 0`)
})

test('keypoint 曲线：插值后首尾对齐输入点', () => {
  const curve = generateKeypointCurve([
    { t: 0, w: 0 },
    { t: 30, w: 45 },
    { t: 90, w: 250 }
  ])
  assert.ok(curve.points.length > 80)
  const first = curve.points[0]
  const last = curve.points[curve.points.length - 1]
  assert.strictEqual(first.t, 0)
  assert.ok(Math.abs(last.w - 250) < 1, `终点 ${last.w}`)
  assert.strictEqual(last.t, 90)
})

test('流速计算对空输入不崩溃', () => {
  assert.deepStrictEqual(computeFlow([]), [])
})

console.log('\n[3] 风味诊断')

const v60 = METHOD_MAP['pour_over_v60']
const base = v60.flavorBaseline

test('吻合度：与基线完全一致时为 100', () => {
  assert.strictEqual(matchScore(base, base), 100)
})

test('偏差方向计算正确', () => {
  const d = axesDelta(
    { ...base, acidity: base.acidity + 3 },
    base
  )
  assert.strictEqual(d.acidity, 3)
})

test('尖酸 + 缺甜 → 判定为萃取不足', () => {
  const d = diagnose(v60, {
    axes: { ...base, acidity: 9, sweetness: base.sweetness - 3, balance: base.balance - 2 },
    descriptors: [],
    defects: [],
    tempStage: 'warm',
    overall: 6,
    note: ''
  })
  assert.strictEqual(d.verdict, 'under_extracted')
  assert.ok(d.prescriptions.length > 0)
  assert.ok(d.prescriptions.some(p => p.action === 'grind_finer'), '应给出研磨调细建议')
})

test('醇厚过高 + 余韵短 → 判定为萃取过度', () => {
  const d = diagnose(v60, {
    axes: { ...base, body: base.body + 4, aftertaste: base.aftertaste - 3, balance: base.balance - 3 },
    descriptors: [],
    defects: [],
    tempStage: 'warm',
    overall: 6,
    note: ''
  })
  assert.strictEqual(d.verdict, 'over_extracted')
  assert.ok(d.prescriptions.some(p => p.action === 'grind_coarser'))
})

test('全部低于基线 → 判定为风味平淡', () => {
  const low = { acidity: 1, sweetness: 2, body: 2, flavor: 3, aftertaste: 2, balance: 2 }
  const d = diagnose(v60, {
    axes: low,
    descriptors: [],
    defects: [],
    tempStage: 'warm',
    overall: 2,
    note: ''
  })
  assert.strictEqual(d.verdict, 'flat')
})

test('风味吻合时给出保持建议', () => {
  const d = diagnose(v60, {
    axes: { ...base },
    descriptors: [],
    defects: [],
    tempStage: 'warm',
    overall: 7,
    note: ''
  })
  assert.strictEqual(d.verdict, 'ok')
  assert.strictEqual(d.prescriptions[0].action, 'keep')
  assert.strictEqual(d.matchScore, 100)
})

test('缺陷标记会触发烘焙检查建议', () => {
  const d = diagnose(v60, {
    axes: { ...base },
    descriptors: [],
    defects: [{ id: 'burnt', label: '焦糊', severity: 2 }],
    tempStage: 'warm',
    overall: 7,
    note: ''
  })
  assert.ok(d.prescriptions.some(p => p.action === 'check_roast'))
})

console.log('\n[4] 烘焙曲线')

test('DTR = (下豆 - 一爆) / 总时长', () => {
  const events = [
    { type: 'charge', atSecond: 0, temperature: 205 },
    { type: 'turningPoint', atSecond: 78, temperature: 108 },
    { type: 'dryEnd', atSecond: 240, temperature: 158 },
    { type: 'firstCrack', atSecond: 348, temperature: 201 },
    { type: 'drop', atSecond: 512, temperature: 216 }
  ]
  const dtr = computeDTR(events, 512)
  assert.strictEqual(dtr, 32)
  const ratio = computePhaseRatio(events, 512)
  assert.strictEqual(ratio.drying, 46.9)
  assert.strictEqual(ratio.development, 32)
  assert.ok(Math.abs(ratio.maillard - 21.1) < 0.2)
})

test('失重率计算正确', () => {
  assert.strictEqual(computeWeightLoss(500, 425), 15)
})

test('RoR：线性升温 10℃/min → 约 10', () => {
  const points = []
  for (let t = 0; t <= 300; t += 5) {
    points.push({ t, bt: 100 + t * (10 / 60) })
  }
  const ror = computeRoR(points)
  const mid = ror[Math.floor(ror.length / 2)]
  assert.ok(Math.abs(mid - 10) < 0.6, `RoR=${mid}`)
})

test('Artisan .alog 解析：能读出数据行与豆温', () => {
  const alog = [
    '# Software: Artisan v2.6.4',
    '# FORMAT: Artisan Scope',
    '# Time\tBean Temp\tEnv Temp\tRoR Rate',
    '0.0\t205.0\t180.0\t0.0',
    '10.0\t180.0\t175.0\t12.5',
    '20.0\t160.0\t170.0\t10.0'
  ].join('\n')
  const { points, warnings } = parseArtisanAlog(alog)
  assert.strictEqual(points.length, 3)
  assert.strictEqual(points[0].bt, 205)
  assert.ok(warnings.length >= 1, '未解析到事件时应给出提示')
})

console.log(`\n${passed} 项断言通过\n`)
