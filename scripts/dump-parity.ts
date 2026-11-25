/**
 * 导出 domain 算法基准输出（用于后端 Python 实现的逐值比对）
 *
 * 前端 TS 是这套算法的第一实现，后端 Python 必须算出**完全一致**的数值，
 * 否则同一条记录两端展示会不一致。
 *
 * 运行：npm run dump:parity  →  backend/tests/fixtures/parity_expected.json
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { BREW_METHODS } from '../src/domain/methods.ts'
import {
  generatePlanCurve,
  generateKeypointCurve,
  cleanDeviceCurve,
  computeFlow,
  curveStats
} from '../src/domain/curve/generate.ts'
import {
  computeRoR,
  computeDTR,
  computePhaseRatio,
  computeWeightLoss,
  parseArtisanAlog,
  generateRoastCurve,
  roastCurveStats,
  checkRorShape
} from '../src/domain/curve/roast.ts'
import { diagnose } from '../src/domain/diagnosis/index.ts'
import { matchScore, axesDelta } from '../src/domain/flavor.ts'

const out: Record<string, unknown> = {}

/* 1. 11 种方式的理论注水曲线 */
out.planCurves = BREW_METHODS.map(m => {
  const total = m.params.brewSeconds?.default ?? 180
  const curve = generatePlanCurve(m.defaultSteps, total)
  return {
    methodId: m.id,
    total,
    steps: m.defaultSteps,
    curve,
    stats: curveStats(curve)
  }
})

/* 2. 关键点曲线 */
const keypoints = [
  { t: 0, w: 0 },
  { t: 12, w: 32 },
  { t: 45, w: 45 },
  { t: 90, w: 170 },
  { t: 165, w: 250 }
]
out.keypointCurve = generateKeypointCurve(keypoints)
out.keypointCurveStats = curveStats(out.keypointCurve as never)

/* 3. 设备采集曲线（含倒退回噪点） */
const deviceRaw = [
  { t: 0, w: 0 },
  { t: 5, w: 6.2 },
  { t: 10, w: 5.9 }, // 倒退噪声
  { t: 15, w: 22.4 },
  { t: 20, w: 44.1 },
  { t: 30, w: 88.7 },
  { t: 45, w: 150.2 },
  { t: 60, w: 205.6 },
  { t: 75, w: 240.0 },
  { t: 90, w: 250.0 }
]
out.deviceCurve = cleanDeviceCurve(deviceRaw)
out.deviceFlow = computeFlow(deviceRaw, 5)

/* 4. 烘焙指标 */
const roastEvents = [
  { type: 'charge' as const, atSecond: 0, temperature: 205 },
  { type: 'turningPoint' as const, atSecond: 78, temperature: 108 },
  { type: 'dryEnd' as const, atSecond: 240, temperature: 158 },
  { type: 'firstCrack' as const, atSecond: 348, temperature: 201 },
  { type: 'drop' as const, atSecond: 512, temperature: 216 }
]
out.roastMetrics = {
  dtr: computeDTR(roastEvents, 512),
  phaseRatio: computePhaseRatio(roastEvents, 512),
  weightLoss: computeWeightLoss(500, 425)
}

/* 5. 烘焙曲线合成 + RoR */
const roastCurve = generateRoastCurve(roastEvents, 512)
out.roastCurve = roastCurve
out.roastCurveStats = roastCurveStats(roastCurve)
out.ror = computeRoR(roastCurve.map(p => ({ t: p.t, bt: p.bt })))
out.rorAnomalies = checkRorShape(
  roastCurve.map(p => ({ t: p.t, bt: p.bt })),
  roastEvents
)

/* 6. Artisan .alog 解析 */
const alogSample = `# Artisan Coffee Roaster 2.2.0
# time\tBean Temp\tEnv Temp\tRoR
# ------------------------------
# Charge\t0\t205\t180
0\t205.4\t180.2\t0
10\t168.3\t182.1\t14.2
20\t145.6\t184.3\t8.7
40\t120.1\t187.9\t5.1
78\t108.2\t189.4\t2.9
120\t124.5\t196.2\t6.1
180\t146.8\t203.5\t5.4
240\t158.3\t210.1\t3.2
300\t178.6\t218.4\t4.9
348\t201.2\t231.0\t4.4
430\t209.8\t238.6\t2.1
512\t216.4\t242.0\t1.8
# First Crack\t348\t201
# Drop\t512\t216
`
out.alog = parseArtisanAlog(alogSample)

/* 7. 风味诊断 */
const v60 = BREW_METHODS.find(m => m.id === 'pour_over_v60')!
const espresso = BREW_METHODS.find(m => m.id === 'espresso')!
const mkFlavor = (axes: Record<string, number>, defects: any[] = [], note = '') => ({
  axes: axes as never,
  descriptors: [],
  defects,
  tempStage: 'warm' as const,
  overall: 7,
  note
})

out.diagnosis = [
  {
    case: 'under_extracted',
    method: v60,
    flavor: mkFlavor(
      { acidity: 8, sweetness: 4, body: 4, flavor: 7, aftertaste: 4, balance: 5 }
    )
  },
  {
    case: 'over_extracted',
    method: v60,
    flavor: mkFlavor(
      { acidity: 3, sweetness: 4, body: 8, flavor: 6, aftertaste: 3, balance: 3 }
    )
  },
  {
    case: 'uneven',
    method: v60,
    flavor: mkFlavor(
      { acidity: 9, sweetness: 9, body: 5, flavor: 8, aftertaste: 6, balance: 3 }
    )
  },
  {
    case: 'flat',
    method: v60,
    flavor: mkFlavor(
      { acidity: 2, sweetness: 2, body: 1, flavor: 3, aftertaste: 2, balance: 2 }
    )
  },
  {
    case: 'ok',
    method: v60,
    flavor: mkFlavor(
      { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 }
    )
  },
  {
    case: 'espresso_under_with_defect',
    method: espresso,
    flavor: mkFlavor(
      { acidity: 7, sweetness: 4, body: 8, flavor: 6, aftertaste: 5, balance: 5 },
      [{ id: 'burnt', label: '焦糊', severity: 2 }],
      '尾段发苦'
    )
  }
].map(item => ({
  case: item.case,
  methodId: item.method.id,
  result: diagnose(item.method, item.flavor as never)
}))

/* 8. 吻合度 */
out.matchScores = [
  [
    { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 },
    { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 }
  ],
  [
    { acidity: 8, sweetness: 3, body: 4, flavor: 7, aftertaste: 4, balance: 5 },
    { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 }
  ],
  [
    { acidity: 2, sweetness: 1, body: 0, flavor: 2, aftertaste: 1, balance: 0 },
    { acidity: 7, sweetness: 6, body: 4, flavor: 8, aftertaste: 6, balance: 6 }
  ]
].map(([a, b]) => ({ score: matchScore(a as never, b as never), delta: axesDelta(a as never, b as never) }))

const fixtureDir = resolve(process.cwd(), 'backend/tests/fixtures')
mkdirSync(fixtureDir, { recursive: true })
writeFileSync(
  resolve(fixtureDir, 'parity_expected.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf-8'
)
console.log('已导出 domain 基准输出 → backend/tests/fixtures/parity_expected.json')
