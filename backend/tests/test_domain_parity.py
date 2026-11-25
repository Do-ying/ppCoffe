"""domain 层与前端 TS 实现的一致性校验。

前端 ``src/domain/`` 是这套算法的第一实现，后端 Python 必须算出**逐值一致**的结果。
基准输出由 ``npm run dump:parity`` 从 TS 侧导出到 ``tests/fixtures/parity_expected.json``。

改动任何一方算法后，都应重新导出基准并跑本测试。
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Dict, List

import pytest

from app.domain import curve as brew_curve
from app.domain import roast as roast_domain
from app.domain.compat import js_to_fixed
from app.domain.diagnosis import diagnose
from app.domain.flavor import axes_delta, match_score
from app.domain.methods import load_methods, method_map

FIXTURES = Path(__file__).parent / "fixtures"
EXPECTED: Dict[str, Any] = json.loads(
    (FIXTURES / "parity_expected.json").read_text(encoding="utf-8")
)


def assert_close(actual: Any, expected: Any, path: str = "") -> None:
    """逐值比对：数值允许 1e-9 的浮点误差，结构必须完全一致。"""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: 期望 dict，实际 {type(actual)}"
        assert set(actual.keys()) == set(expected.keys()), (
            f"{path}: 字段不一致，缺少 {set(expected) - set(actual)}，多出 {set(actual) - set(expected)}"
        )
        for key in expected:
            assert_close(actual[key], expected[key], f"{path}.{key}" if path else str(key))
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: 期望 list，实际 {type(actual)}"
        assert len(actual) == len(expected), f"{path}: 长度不一致 {len(actual)} != {len(expected)}"
        for i, (a, e) in enumerate(zip(actual, expected)):
            assert_close(a, e, f"{path}[{i}]")
    elif isinstance(expected, (int, float)) and not isinstance(expected, bool):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), (
            f"{path}: 期望数值，实际 {type(actual)}"
        )
        if math.isnan(expected):
            assert math.isnan(actual), f"{path}: 期望 NaN"
        else:
            assert actual == pytest.approx(expected, abs=1e-9, rel=1e-12), (
                f"{path}: 数值不一致 actual={actual} expected={expected}"
            )
    else:
        assert actual == expected, f"{path}: 值不一致 actual={actual!r} expected={expected!r}"


# --------------------------------------------------------------------- #
#  1. 冲煮理论曲线（11 种方式）
# --------------------------------------------------------------------- #


@pytest.mark.parametrize("case", EXPECTED["planCurves"], ids=lambda c: c["methodId"])
def test_plan_curve_matches_frontend(case: Dict[str, Any]) -> None:
    result = brew_curve.generate_plan_curve(case["steps"], case["total"])
    assert_close(result, case["curve"])
    assert_close(brew_curve.curve_stats(result), case["stats"])


def test_keypoint_curve_matches_frontend() -> None:
    keypoints = [
        {"t": 0, "w": 0},
        {"t": 12, "w": 32},
        {"t": 45, "w": 45},
        {"t": 90, "w": 170},
        {"t": 165, "w": 250},
    ]
    result = brew_curve.generate_keypoint_curve(keypoints)
    assert_close(result, EXPECTED["keypointCurve"])
    assert_close(brew_curve.curve_stats(result), EXPECTED["keypointCurveStats"])


def test_device_curve_matches_frontend() -> None:
    raw = [
        {"t": 0, "w": 0},
        {"t": 5, "w": 6.2},
        {"t": 10, "w": 5.9},  # 倒退噪声
        {"t": 15, "w": 22.4},
        {"t": 20, "w": 44.1},
        {"t": 30, "w": 88.7},
        {"t": 45, "w": 150.2},
        {"t": 60, "w": 205.6},
        {"t": 75, "w": 240.0},
        {"t": 90, "w": 250.0},
    ]
    result = brew_curve.clean_device_curve(raw)
    assert_close(result, EXPECTED["deviceCurve"])


def test_compute_flow_matches_frontend() -> None:
    raw = [
        {"t": 0, "w": 0},
        {"t": 5, "w": 6.2},
        {"t": 10, "w": 5.9},
        {"t": 15, "w": 22.4},
        {"t": 20, "w": 44.1},
        {"t": 30, "w": 88.7},
        {"t": 45, "w": 150.2},
        {"t": 60, "w": 205.6},
        {"t": 75, "w": 240.0},
        {"t": 90, "w": 250.0},
    ]
    flows = brew_curve.compute_flow([(p["t"], p["w"]) for p in raw], 5)
    assert_close(flows, EXPECTED["deviceFlow"])


# --------------------------------------------------------------------- #
#  2. 烘焙指标与曲线
# --------------------------------------------------------------------- #


ROAST_EVENTS = [
    {"type": "charge", "atSecond": 0, "temperature": 205},
    {"type": "turningPoint", "atSecond": 78, "temperature": 108},
    {"type": "dryEnd", "atSecond": 240, "temperature": 158},
    {"type": "firstCrack", "atSecond": 348, "temperature": 201},
    {"type": "drop", "atSecond": 512, "temperature": 216},
]


def test_roast_metrics_match_frontend() -> None:
    assert roast_domain.compute_dtr(ROAST_EVENTS, 512) == EXPECTED["roastMetrics"]["dtr"]
    assert roast_domain.compute_phase_ratio(
        ROAST_EVENTS, 512
    ) == EXPECTED["roastMetrics"]["phaseRatio"]
    assert roast_domain.compute_weight_loss(500, 425) == EXPECTED["roastMetrics"]["weightLoss"]


def test_roast_curve_matches_frontend() -> None:
    curve = roast_domain.generate_roast_curve(ROAST_EVENTS, 512)
    assert_close(curve, EXPECTED["roastCurve"])
    assert_close(roast_domain.roast_curve_stats(curve), EXPECTED["roastCurveStats"])


def test_ror_matches_frontend() -> None:
    curve = roast_domain.generate_roast_curve(ROAST_EVENTS, 512)
    ror = roast_domain.compute_ror([{"t": p["t"], "bt": p["bt"]} for p in curve])
    assert_close(ror, EXPECTED["ror"])


def test_ror_anomalies_match_frontend() -> None:
    curve = roast_domain.generate_roast_curve(ROAST_EVENTS, 512)
    anomalies = roast_domain.check_ror_shape(
        [{"t": p["t"], "bt": p["bt"]} for p in curve], ROAST_EVENTS
    )
    assert_close(anomalies, EXPECTED["rorAnomalies"])


ALOG_SAMPLE = """# Artisan Coffee Roaster 2.2.0
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
"""


def test_artisan_alog_parse_matches_frontend() -> None:
    result = roast_domain.parse_artisan_alog(ALOG_SAMPLE)
    assert_close(result, EXPECTED["alog"])


# --------------------------------------------------------------------- #
#  3. 风味诊断
# --------------------------------------------------------------------- #


@pytest.mark.parametrize("case", EXPECTED["diagnosis"], ids=lambda c: c["case"])
def test_diagnosis_matches_frontend(case: Dict[str, Any]) -> None:
    method = method_map()[case["methodId"]]
    flavor = _flavor_for_case(case["case"])
    result = diagnose(method, flavor)
    assert_close(result, case["result"])


def _flavor_for_case(case: str) -> Dict[str, Any]:
    axes_map = {
        "under_extracted": {
            "acidity": 8,
            "sweetness": 4,
            "body": 4,
            "flavor": 7,
            "aftertaste": 4,
            "balance": 5,
        },
        "over_extracted": {
            "acidity": 3,
            "sweetness": 4,
            "body": 8,
            "flavor": 6,
            "aftertaste": 3,
            "balance": 3,
        },
        "uneven": {
            "acidity": 9,
            "sweetness": 9,
            "body": 5,
            "flavor": 8,
            "aftertaste": 6,
            "balance": 3,
        },
        "flat": {
            "acidity": 2,
            "sweetness": 2,
            "body": 1,
            "flavor": 3,
            "aftertaste": 2,
            "balance": 2,
        },
        "ok": {
            "acidity": 7,
            "sweetness": 6,
            "body": 4,
            "flavor": 8,
            "aftertaste": 6,
            "balance": 6,
        },
        "espresso_under_with_defect": {
            "acidity": 7,
            "sweetness": 4,
            "body": 8,
            "flavor": 6,
            "aftertaste": 5,
            "balance": 5,
        },
    }
    defects = (
        [{"id": "burnt", "label": "焦糊", "severity": 2}]
        if case == "espresso_under_with_defect"
        else []
    )
    return {
        "axes": axes_map[case],
        "descriptors": [],
        "defects": defects,
        "tempStage": "warm",
        "overall": 7,
        "note": "尾段发苦",
    }


def test_match_score_matches_frontend() -> None:
    for case in EXPECTED["matchScores"]:
        actual_score = match_score(case["delta"], case["delta"])
        # 基准里的 delta 字段是差值，这里用基准中的原始轴重算
        assert actual_score >= 0
    # 精确比对：用基准中的三组轴
    groups = [
        (
            {"acidity": 7, "sweetness": 6, "body": 4, "flavor": 8, "aftertaste": 6, "balance": 6},
            {"acidity": 7, "sweetness": 6, "body": 4, "flavor": 8, "aftertaste": 6, "balance": 6},
        ),
        (
            {"acidity": 8, "sweetness": 3, "body": 4, "flavor": 7, "aftertaste": 4, "balance": 5},
            {"acidity": 7, "sweetness": 6, "body": 4, "flavor": 8, "aftertaste": 6, "balance": 6},
        ),
        (
            {"acidity": 2, "sweetness": 1, "body": 0, "flavor": 2, "aftertaste": 1, "balance": 0},
            {"acidity": 7, "sweetness": 6, "body": 4, "flavor": 8, "aftertaste": 6, "balance": 6},
        ),
    ]
    for (a, b), expected in zip(groups, EXPECTED["matchScores"]):
        assert match_score(a, b) == expected["score"]
        assert_close(axes_delta(a, b), expected["delta"])


# --------------------------------------------------------------------- #
#  4. 元数据完整性
# --------------------------------------------------------------------- #


def test_methods_metadata_complete() -> None:
    methods = load_methods()
    assert len(methods) == 11
    for m in methods:
        assert m["name"]
        assert m["grindHint"]
        assert m["flavorBaseline"]
        assert len(m["defaultSteps"]) >= 2
        for value in m["flavorBaseline"].values():
            assert 0 <= value <= 10
        assert m["id"] in method_map()


def test_js_to_fixed_matches_js_semantics() -> None:
    # JS: (2.675).toFixed(2) === "2.67"（二进制精确值 2.67499...）
    assert js_to_fixed(2.675, 2) == 2.67
    # JS: (0.5).toFixed(0) === "1"（Python round(0.5) 会得到 0）
    assert js_to_fixed(0.5, 0) == 1
    assert js_to_fixed(-0.5, 0) == -1
    assert js_to_fixed(1.005, 2) == 1.0
