"""JS 数值语义兼容层

前端 domain 层用 JavaScript 写的，后端要产出**完全一致的数值**，
否则同一个输入两边算出来的曲线/诊断分值会对不上。

这里补齐三处最容易出偏差的 JS 语义：

1. ``Number(x.toFixed(n))`` —— 四舍五入（half away from zero），且基于**精确二进制值**判断。
   Python 内置 ``round()`` 是「银行家舍入」，在 ``.5`` 边界上结果不同，不能直接用。
2. ``Math.round(x)`` —— 向 +∞ 取整（``2.5 -> 3``、``-2.5 -> -2``），同样不同于 Python 的 ``round()``。
3. ``parseFloat(s)`` —— 解析字符串的**前导数值**，允许尾部残留非数字字符。

参考：docs/02-接口契约.md 第 6 节「派生计算」。
"""

from __future__ import annotations

import math
import re
from decimal import ROUND_HALF_UP, Decimal

__all__ = ["js_to_fixed", "js_round", "js_parse_float", "js_max", "js_min"]


def js_to_fixed(value: float, digits: int) -> float:
    """等价于 JS ``Number(x.toFixed(digits))``。

    JS 的 ``toFixed`` 基于精确二进制值做「四舍五入，逢五进位」，
    因此这里用 ``Decimal(value)``（而非 ``Decimal(repr(value))``）拿到精确值再舍入。
    """
    if value is None:
        return 0.0
    if isinstance(value, bool):
        value = float(value)
    if not isinstance(value, (int, float)):
        raise TypeError(f"js_to_fixed 需要数值，收到 {type(value)!r}")
    if math.isnan(value) or math.isinf(value):
        return float(value)

    factor = Decimal(10) ** digits
    scaled = Decimal(value) * factor
    rounded = scaled.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return float(rounded) / float(factor)


def js_round(value: float) -> int:
    """等价于 JS ``Math.round``：向 +∞ 取整的半整数。"""
    if math.isnan(value) or math.isinf(value):
        raise ValueError("js_round 不接受 NaN/Inf")
    return math.floor(value + 0.5)


_JS_FLOAT_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def js_parse_float(text: str) -> float:
    """等价于 JS ``parseFloat``：解析前导数值，失败返回 NaN。"""
    if text is None:
        return float("nan")
    match = _JS_FLOAT_RE.match(text.strip())
    if not match:
        return float("nan")
    try:
        return float(match.group(0))
    except ValueError:  # pragma: no cover - 正则已保证可解析
        return float("nan")


def js_max(*args: float) -> float:
    """等价于 JS ``Math.max``（忽略 NaN 的差异仅在极端场景出现，这里做保守处理）。"""
    return max(args)


def js_min(*args: float) -> float:
    """等价于 JS ``Math.min``。"""
    return min(args)
