"""单调三次样条插值（Fritsch-Carlson）

对应前端 ``src/domain/curve/interpolate.ts``。

冲煮曲线「重量只增不减」，普通三次样条会在数据点之间过冲产生负流速，
所以必须用单调版本。

本文件是纯函数层，不依赖 Flask / SQLAlchemy，可在任意环境单测。
"""

from __future__ import annotations

from typing import Iterable, List, Sequence, Tuple

from .compat import js_round

__all__ = ["KeyPoint", "monotone_cubic_interp", "smooth_curve"]

KeyPoint = Tuple[float, float]


def monotone_cubic_interp(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    m0: float,
    m1: float,
    samples: int,
) -> List[KeyPoint]:
    """对两个关键点做单调三次插值，返回在 [x0, x1] 内采样得到的点。"""
    out: List[KeyPoint] = []
    h = x1 - x0
    if h <= 0:
        return out
    for i in range(samples + 1):
        t = i / samples
        t2 = t * t
        t3 = t2 * t
        h00 = 2 * t3 - 3 * t2 + 1
        h10 = t3 - 2 * t2 + t
        h01 = -2 * t3 + 3 * t2
        h11 = t3 - t2
        out.append((x0 + h * t, h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1))
    return out


def smooth_curve(points: Sequence[KeyPoint], interval: float = 1) -> List[KeyPoint]:
    """对关键点序列做整体单调三次插值。

    :param points: 关键点（按 t 升序）
    :param interval: 采样间隔（秒）
    """
    if len(points) < 2:
        return list(points)

    n = len(points)
    # 各段斜率
    delta: List[float] = []
    for i in range(n - 1):
        dx = points[i + 1][0] - points[i][0]
        delta.append(0 if dx == 0 else (points[i + 1][1] - points[i][1]) / dx)

    # 端点斜率
    m: List[float] = [0.0] * n
    m[0] = delta[0]
    m[n - 1] = delta[n - 2]
    for i in range(1, n - 1):
        if delta[i - 1] * delta[i] <= 0:
            m[i] = 0
        else:
            w1 = 2 * (points[i + 1][0] - points[i][0]) + (points[i][0] - points[i - 1][0])
            w2 = (points[i + 1][0] - points[i][0]) + 2 * (points[i][0] - points[i - 1][0])
            m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])

    out: List[KeyPoint] = []
    for i in range(n - 1):
        x0 = points[i][0]
        x1 = points[i + 1][0]
        count = max(1, js_round((x1 - x0) / interval))
        seg = monotone_cubic_interp(
            x0, points[i][1], x1, points[i + 1][1], m[i], m[i + 1], count
        )
        # 去掉与下一段重复的首点（保留最后一段的完整尾部）
        trimmed = seg if i == n - 2 else seg[:-1]
        out.extend(trimmed)
    return out
