/**
 * 养豆状态计算（前端口径）。
 *
 * ⚠️ 必须与后端 `backend/app/domain/rest.py` 保持一致 ——
 *    首页摘要与豆子详情用同一套算法，否则同一支豆在两处显示不同阶段。
 *
 * 口径（按**自然日**计算）：
 *   - 0–6 天   → 养豆期 `resting`
 *   - 7–21 天  → 赏味期 `peak`
 *   - 22 天起  → 风味衰减期 `fading`
 *
 * 起点：
 *   - 成品豆：豆子上的包装烘焙日期
 *   - 生豆：具体炉次的烘焙日期
 *   - 日期未知 → `unknown`（页面显示「烘焙日期未知」）
 */

import type { RestStage, RestStageInfo } from './types'

export const REST_STAGE_LABELS: Record<RestStage, string> = {
  resting: '养豆期',
  peak: '赏味期',
  fading: '风味衰减',
  unknown: '烘焙日期未知'
}

/** 把各种日期形态统一成天���数偏移前的 date 字符串。 */
function toDate(value?: string | null): Date | null {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00` : text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

/** 按自然日计算养豆阶段。 */
export function restStage(roastDate?: string | null, today?: Date): RestStage {
  const start = toDate(roastDate)
  if (!start) return 'unknown'
  const ref = today ?? new Date()
  // 只取日期部分计算，避免时分秒带来的边界误差
  const days = Math.floor(
    (new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime() -
      new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
      86400000
  )
  if (days < 0) return 'resting'
  if (days < 7) return 'resting'
  if (days <= 21) return 'peak'
  return 'fading'
}

/** 养豆阶段的完整信息（阶段、标签、天数）。 */
export function restStageInfo(roastDate?: string | null, today?: Date): RestStageInfo {
  const start = toDate(roastDate)
  const stage = restStage(roastDate, today)
  const ref = today ?? new Date()
  let days: number | undefined
  if (start) {
    days = Math.floor(
      (new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime() -
        new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
        86400000
    )
  }
  return {
    stage,
    label: REST_STAGE_LABELS[stage],
    days,
    roastDate: start ? start.toISOString().slice(0, 10) : undefined
  }
}
