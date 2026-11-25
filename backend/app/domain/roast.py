"""烘豆曲线分析

对应前端 ``src/domain/curve/roast.ts``。

指标口径对齐 Artisan（事实标准）：

* RoR  = dBT/dt，单位 °C/min，中心差分 + 30s 中心窗口平滑
* DTR  = (下豆时刻 - 一爆时刻) / 总时长
* 阶段 = 脱水 / 梅纳 / 发展，依据事件标记切分
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .compat import js_parse_float, js_round, js_to_fixed
from .interpolate import smooth_curve

__all__ = [
    "ROAST_PHASE_LABELS",
    "compute_ror",
    "find_event",
    "compute_dtr",
    "compute_weight_loss",
    "compute_phase_ratio",
    "compute_roast_metrics",
    "check_ror_shape",
    "parse_artisan_alog",
    "roast_phase_at",
    "generate_roast_curve",
    "roast_curve_stats",
    "infer_missing_events",
]

ROAST_PHASE_LABELS: Dict[str, str] = {
    "drying": "脱水",
    "maillard": "梅纳",
    "development": "发展",
}

RoastPoint = Dict[str, Any]


def compute_ror(points: Sequence[RoastPoint], window_seconds: float = 30) -> List[float]:
    """计算升温率 RoR（°C/min）。

    :param points: 豆温序列
    :param window_seconds: 平滑窗口（秒），Artisan 默认 30
    """
    n = len(points)
    out: List[float] = [0.0] * n
    for i in range(n):
        # 取窗口内最早的可用点
        start = i
        while start > 0 and points[i]["t"] - points[start]["t"] < window_seconds:
            start -= 1
        end = min(n - 1, i)
        dt = points[end]["t"] - points[start]["t"]
        if dt <= 0:
            out[i] = 0.0
            continue
        out[i] = ((points[end]["bt"] - points[start]["bt"]) / dt) * 60

    # 轻度平滑，去除尖刺
    smoothed: List[float] = []
    for i, v in enumerate(out):
        prev = out[i - 1] if i - 1 >= 0 else v
        nxt = out[i + 1] if i + 1 < n else v
        smoothed.append(js_to_fixed((prev + v * 2 + nxt) / 4, 2))
    return smoothed


def find_event(
    events: Sequence[Dict[str, Any]], event_type: str
) -> Optional[Dict[str, Any]]:
    """按类型查找事件。"""
    for e in events:
        if e.get("type") == event_type:
            return e
    return None


def compute_dtr(events: Sequence[Dict[str, Any]], total_seconds: float) -> float:
    """发展比 DTR（%）。"""
    fc = find_event(events, "firstCrack")
    drop = find_event(events, "drop")
    if not fc or not drop or not total_seconds:
        return 0
    return js_to_fixed(((drop["atSecond"] - fc["atSecond"]) / total_seconds) * 100, 1)


def compute_weight_loss(green_grams: float, out_grams: float) -> float:
    """失重率（%）。"""
    if not green_grams:
        return 0
    return js_to_fixed(((green_grams - out_grams) / green_grams) * 100, 1)


def compute_phase_ratio(
    events: Sequence[Dict[str, Any]], total_seconds: float
) -> Dict[str, float]:
    """三个阶段的时长占比（%）。"""
    charge = find_event(events, "charge")
    de = find_event(events, "dryEnd")
    fc = find_event(events, "firstCrack")
    drop = find_event(events, "drop")
    if not charge or not de or not fc or not drop or not total_seconds:
        return {"drying": 0, "maillard": 0, "development": 0}

    def pct(v: float) -> float:
        return js_to_fixed((v / total_seconds) * 100, 1)

    return {
        "drying": pct(de["atSecond"] - charge["atSecond"]),
        "maillard": pct(fc["atSecond"] - de["atSecond"]),
        "development": pct(drop["atSecond"] - fc["atSecond"]),
    }


def compute_roast_metrics(batch: Dict[str, Any]) -> Dict[str, Any]:
    """完整的烘焙指标。"""
    return {
        "weightLossPercent": compute_weight_loss(
            batch["greenGrams"], batch["outGrams"]
        ),
        "dtrPercent": compute_dtr(batch["events"], batch["totalSeconds"]),
        "phaseRatio": compute_phase_ratio(batch["events"], batch["totalSeconds"]),
    }


def check_ror_shape(
    points: Sequence[RoastPoint], events: Sequence[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """RoR 形态健康度检查。

    典型健康形态：初期高（15-25℃/min）→ 梅纳期平稳下降 → 一爆前 5-15℃/min
    """
    ror = compute_ror(points)
    anomalies: List[Dict[str, Any]] = []
    fc = find_event(events, "firstCrack")

    for i in range(1, len(ror)):
        prev = ror[i - 1]
        cur = ror[i]
        t = points[i]["t"]
        # Crash：RoR 骤降超过 3℃/min
        if prev - cur > 3 and prev > 6:
            anomalies.append(
                {
                    "type": "crash",
                    "atSecond": t,
                    "value": cur,
                    "message": (
                        f"第 {js_round(t)} 秒 RoR 骤降 {js_to_fixed(prev - cur, 1)}℃/min，"
                        "可能出现焦苦或 underdeveloped"
                    ),
                }
            )
        # Flick：RoR 尖刺
        if cur - prev > 2.5 and cur > 12:
            anomalies.append(
                {
                    "type": "flick",
                    "atSecond": t,
                    "value": cur,
                    "message": (
                        f"第 {js_round(t)} 秒 RoR 尖刺 {js_to_fixed(cur - prev, 1)}℃/min，"
                        "可能着色不均或焦糊"
                    ),
                }
            )

    # 一爆前 RoR 过低：热力不足
    if fc:
        before = [p for p in points if p["t"] < fc["atSecond"]][-5:]
        if before:
            idx = next(
                (i for i, p in enumerate(points) if p["t"] == before[-1]["t"]),
                None,
            )
            if idx is not None:
                values = [
                    ror[idx - len(before) + 1 + i]
                    for i in range(len(before))
                    if 0 <= idx - len(before) + 1 + i < len(ror)
                ]
                avg = sum(values) / len(before) if values else 0
                if 0 < avg < 3:
                    anomalies.append(
                        {
                            "type": "low",
                            "atSecond": fc["atSecond"],
                            "value": js_to_fixed(avg, 2),
                            "message": (
                                f"一爆前 RoR 仅 {js_to_fixed(avg, 1)}℃/min，"
                                "发展期热量不足，可能影响甜感"
                            ),
                        }
                    )
    return anomalies


# ------------------------------------------------------------------ #
#  Artisan .alog 解析
# ------------------------------------------------------------------ #

_EVENT_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"charge", re.I), "charge"),
    (re.compile(r"turning\s*point|tp\b", re.I), "turningPoint"),
    (re.compile(r"dry\s*end|de\b", re.I), "dryEnd"),
    (re.compile(r"first\s*crack|\bfc\b", re.I), "firstCrack"),
    (re.compile(r"drop", re.I), "drop"),
]

_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")
_SPLIT_RE = re.compile(r"[\t,]")
_COMMENT_PREFIX_RE = re.compile(r"^#\s*")
_BEAN_TEMP_RE = re.compile(r"bean\s*temp", re.I)


def _split_cols(line: str) -> List[str]:
    stripped = _COMMENT_PREFIX_RE.sub("", line)
    return [c.strip() for c in _SPLIT_RE.split(stripped)]


def _pick(header: List[str], cols: List[str], pattern: re.Pattern, index: int) -> Optional[float]:
    for i, h in enumerate(header):
        if pattern.search(h) and i < len(cols):
            v = js_parse_float(cols[i])
            if v == v:  # not NaN
                return v
    if index < len(cols):
        v = js_parse_float(cols[index])
        if v == v:
            return v
    return None


def parse_artisan_alog(text: str) -> Dict[str, Any]:
    """解析 Artisan .alog 文件。

    .alog 为制表符分隔的 CSV，注释行以 # 开头，数据区有 "Bean Temp" 表头。
    """
    warnings: List[str] = []
    points: List[RoastPoint] = []
    events: List[Dict[str, Any]] = []
    lines = text.splitlines()

    header: Optional[List[str]] = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue

        # Artisan 的列名行同样带 # 前缀，统一剥掉后再判断是否为表头
        cols = _split_cols(line)

        if header is None:
            if any(_BEAN_TEMP_RE.search(c) for c in cols):
                header = [c.lower() for c in cols]
            continue

        t = _pick(header, cols, re.compile(r"^(time|t)$", re.I), 0)
        if t is None:
            continue
        bt = _pick(header, cols, re.compile(r"bean", re.I), 1)
        if bt is None:
            continue
        et = _pick(header, cols, re.compile(r"env", re.I), 2)
        point: RoastPoint = {"t": t, "bt": bt}
        if et is not None:
            point["et"] = et
        points.append(point)

    # 尽力解析事件标记：形如 "First Crack, 348, 201" 或 "Charge: 0, 205"
    for raw in lines:
        line = _COMMENT_PREFIX_RE.sub("", raw).strip()
        if not line or _BEAN_TEMP_RE.search(line):
            continue
        for pattern, event_type in _EVENT_PATTERNS:
            if not pattern.search(line):
                continue
            nums = _NUMBER_RE.findall(line)
            if len(nums) < 2:
                break
            at_second = js_parse_float(nums[0])
            temperature = js_parse_float(nums[1])
            if at_second != at_second or temperature != temperature:
                break
            if not any(e["type"] == event_type for e in events):
                events.append(
                    {"type": event_type, "atSecond": at_second, "temperature": temperature}
                )
            break

    if not points:
        warnings.append("未解析到数据行，请确认文件为 Artisan .alog 格式")
    if not events:
        warnings.append("未检测到一爆/下豆事件标记，请在曲线详情页手工确认")

    return {"points": points, "events": events, "warnings": warnings}


def infer_missing_events(
    points: Sequence[RoastPoint],
    events: Sequence[Dict[str, Any]],
    *,
    dry_end_threshold: float = 155.0,
) -> List[Dict[str, Any]]:
    """按曲线特征补齐缺失的事件标记。

    对应 docs/00-产品与页面规划.md 第 4.2 节：
    「缺标记时按温度阈值自动推断（DE ≈ 150–160℃ 转折、FC 由听感或曲线拐点标注）」。

    规则：

    * ``turningPoint`` —— 豆温由降转升的最低点
    * ``dryEnd``       —— 豆温首次越过 155℃ 的时刻
    * ``drop``         —— 曲线最后一点

    ``firstCrack`` 依赖听感，不做推断，保留给用户手工标注。
    """
    result = list(events)
    if not points:
        return result

    ordered = sorted(points, key=lambda p: p["t"])

    # 回温点：豆温由降转升的最低点（先算，后面找 DE 要用到）
    turning_point = find_event(result, "turningPoint")
    if not turning_point:
        lowest = min(ordered, key=lambda p: p["bt"])
        turning_point = {
            "type": "turningPoint",
            "atSecond": int(lowest["t"]),
            "temperature": round(float(lowest["bt"]), 1),
        }
        result.append(turning_point)

    if not find_event(result, "dryEnd"):
        # 脱水结束是**回温之后**的升温段越过阈值的那一刻，
        # 不能从投豆点起算（投豆温度本身就高于阈值）
        after_tp = [p for p in ordered if p["t"] > turning_point["atSecond"]]
        crossed = next((p for p in after_tp if p["bt"] >= dry_end_threshold), None)
        if crossed:
            result.append(
                {
                    "type": "dryEnd",
                    "atSecond": int(crossed["t"]),
                    "temperature": round(float(crossed["bt"]), 1),
                }
            )

    if not find_event(result, "drop"):
        last = ordered[-1]
        result.append(
            {
                "type": "drop",
                "atSecond": int(last["t"]),
                "temperature": round(float(last["bt"]), 1),
            }
        )

    result.sort(key=lambda e: e["atSecond"])
    return result


# ------------------------------------------------------------------ #
#  由事件标记合成烘焙曲线（无硬件时的理论曲线）
# ------------------------------------------------------------------ #

def roast_phase_at(t: float, events: Sequence[Dict[str, Any]]) -> str:
    """根据时间判定所处阶段。"""
    de = find_event(events, "dryEnd")
    fc = find_event(events, "firstCrack")
    if de and t < de["atSecond"]:
        return "drying"
    if fc and t < fc["atSecond"]:
        return "maillard"
    return "development"


def generate_roast_curve(
    events: Sequence[Dict[str, Any]], total_seconds: float, interval: float = 2
) -> List[Dict[str, Any]]:
    """由事件标记合成一条烘焙曲线。

    * 豆温 BT：以事件点为关键点做单调三次插值
    * 环境温 ET：按阶段经验值推算
    * 升温率 RoR：对 BT 序列差分得到（与 Artisan 的 30s 中心窗口口径一致）
    """
    ordered = sorted(events, key=lambda e: e["atSecond"])
    if not ordered:
        return []

    bt_keys = [(float(e["atSecond"]), float(e["temperature"])) for e in ordered]
    if bt_keys[0][0] > 0:
        bt_keys.insert(0, (0.0, bt_keys[0][1]))
    bt = smooth_curve(bt_keys, interval)

    et_keys: List[Tuple[float, float]] = []
    for e in ordered:
        t = e["temperature"]
        event_type = e["type"]
        if event_type == "charge":
            et = t * 0.88
        elif event_type == "turningPoint":
            et = t + 62
        elif event_type == "dryEnd":
            et = t + 42
        elif event_type == "firstCrack":
            et = t + 30
        else:
            et = t + 26
        et_keys.append((float(e["atSecond"]), float(et)))
    if et_keys[0][0] > 0:
        et_keys.insert(0, (0.0, et_keys[0][1]))
    et = smooth_curve(et_keys, interval)

    ror = compute_ror([{"t": p[0], "bt": p[1]} for p in bt])

    out: List[Dict[str, Any]] = []
    for i, (t, w) in enumerate(bt):
        out.append(
            {
                "t": min(js_round(t), int(total_seconds)),
                "bt": js_to_fixed(w, 1),
                "et": js_to_fixed(et[i][1] if i < len(et) else 0.0, 1),
                "ror": js_to_fixed(ror[i] if i < len(ror) else 0.0, 2),
            }
        )
    return out


def roast_curve_stats(points: Sequence[Dict[str, Any]]) -> Dict[str, float]:
    """曲线关键统计。"""
    if not points:
        return {"maxBt": 0, "maxEt": 0, "peakRor": 0, "turningPoint": 0}
    max_bt = max(p["bt"] for p in points)
    max_et = max(p["et"] for p in points)
    peak_ror = max(p["ror"] for p in points)
    # 转折点：豆温由降转升的最低点
    turning_point = 0
    lowest = float("inf")
    for p in points:
        if p["bt"] < lowest:
            lowest = p["bt"]
            turning_point = p["t"]
    return {
        "maxBt": js_to_fixed(max_bt, 1),
        "maxEt": js_to_fixed(max_et, 1),
        "peakRor": js_to_fixed(peak_ror, 1),
        "turningPoint": turning_point,
    }
