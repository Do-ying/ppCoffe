/**
 * 单调三次样条插值（Fritsch-Carlson）
 *
 * 用于曲线平滑：相比普通三次样条，单调版本不会在数据点之间产生过冲，
 * 冲煮曲线这种「重量只增不减」的场景必须用它，否则会出现负流速等物理错误。
 */

export interface KeyPoint {
  t: number
  w: number
}

/** 对两个关键点做单调三次插值，返回在 [x0,x1] 区间内采样得到的点 */
export function monotoneCubicInterp(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  m0: number,
  m1: number,
  samples: number
): { t: number; w: number }[] {
  const out: { t: number; w: number }[] = []
  const h = x1 - x0
  if (h <= 0) return out
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    out.push({
      t: x0 + h * t,
      w: h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1
    })
  }
  return out
}

/**
 * 对关键点序列做整体单调三次插值
 * @param points 关键点（按 t 升序）
 * @param interval 采样间隔（秒）
 */
export function smoothCurve(points: KeyPoint[], interval = 1): { t: number; w: number }[] {
  if (points.length < 2) return points.slice()

  const n = points.length
  // 斜率
  const delta: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].t - points[i].t
    delta.push(dx === 0 ? 0 : (points[i + 1].w - points[i].w) / dx)
  }

  // 端点斜率
  const m: number[] = new Array(n)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0
    } else {
      const w1 = 2 * (points[i + 1].t - points[i].t) + (points[i].t - points[i - 1].t)
      const w2 = (points[i + 1].t - points[i].t) + 2 * (points[i].t - points[i - 1].t)
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    }
  }

  const out: { t: number; w: number }[] = []
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i].t
    const x1 = points[i + 1].t
    const count = Math.max(1, Math.round((x1 - x0) / interval))
    const seg = monotoneCubicInterp(x0, points[i].w, x1, points[i + 1].w, m[i], m[i + 1], count)
    // 去掉与下一段重复的首点（保留最后一段的完整尾部）
    const trimmed = i === n - 2 ? seg : seg.slice(0, -1)
    trimmed.forEach(p => out.push(p))
  }
  return out
}
