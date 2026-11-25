"""演示数据。

与前端 ``src/mock/db.ts`` 的 fixtures 保持一致，方便对照两端的展示效果。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List

from ..domain import curve as brew_curve
from ..domain import roast as roast_domain
from ..domain.methods import method_map
from ..extensions import db
from ..ids import new_id
from ..models.bean import Bean
from ..models.brew import BrewCurve, BrewRecord
from ..models.misc import Equipment
from ..models.mixins import utcnow
from ..models.roast import RoastBatch, RoastCurve

__all__ = ["seed_demo_data"]


def _flavor(axes: Dict[str, int], note: str = "") -> Dict[str, Any]:
    return {
        "axes": axes,
        "descriptors": [],
        "defects": [],
        "tempStage": "warm",
        "overall": round(sum(axes.values()) / 6, 1),
        "note": note,
    }


def _build_brew(
    bean_id: str,
    method_id: str,
    dose: float,
    water: float,
    seconds: int,
    temp: float,
    axes: Dict[str, int],
    note: str,
    days_ago: int,
) -> BrewRecord:
    method = method_map()[method_id]
    steps = [dict(s) for s in method["defaultSteps"]]
    curve = brew_curve.generate_plan_curve(steps, seconds)
    when = utcnow() - timedelta(days=days_ago)

    brew = BrewRecord(
        id=new_id("br"),
        bean_id=bean_id,
        method=method_id,
        params={
            "doseGrams": dose,
            "waterGrams": water,
            "yieldGrams": round(water * 0.9),
            "brewSeconds": seconds,
            "temperature": temp,
            "preinfusionSeconds": method["params"].get("preinfusionSeconds", {}).get("default"),
            "ratio": round(water / dose, 2),
        },
        steps=steps,
        flavor=_flavor(axes, note),
        notes=note,
        brew_date=when,
    )
    db.session.add(brew)
    db.session.flush()
    db.session.add(
        BrewCurve(
            id=new_id("cv"),
            brew_id=brew.id,
            source="plan",
            points=curve["points"],
            stages=curve["stages"],
            meta={"generator": "monotone-cubic-v1"},
        )
    )
    return brew


def seed_demo_data() -> Dict[str, int]:
    """写入演示数据（已存在则跳过）。"""
    counts = {"beans": 0, "brews": 0, "roasts": 0, "equipment": 0}

    if db.session.query(Bean).count() > 0:
        return {"skipped": 1}

    today = date.today()
    beans = [
        Bean(
            id=new_id("bn"),
            name="耶加雪菲 · 科契尔 水洗 G1",
            roaster="几何咖啡",
            origin={
                "country": "埃塞俄比亚",
                "region": "Sidama",
                "farm": "Kochere",
                "altitudeMasl": 1950,
                "variety": "74158",
            },
            process="washed",
            roast_level="light",
            agtron=62,
            roast_date=today - timedelta(days=13),
            weight_grams=200,
            remaining_grams=120,
            tags=["花果香"],
            notes="柑橘与白桃，尾段有红茶感",
        ),
        Bean(
            id=new_id("bn"),
            name="哥伦比亚 · 慧兰 慢速日晒",
            roaster="乔治队长",
            origin={"country": "哥伦比亚", "region": "Huila", "farm": "El Diviso", "altitudeMasl": 1800},
            process="natural",
            roast_level="medium",
            roast_date=today - timedelta(days=7),
            weight_grams=250,
            remaining_grams=250,
            tags=["莓果"],
            notes="发酵感莓果，焦糖甜感明显",
        ),
        Bean(
            id=new_id("bn"),
            name="巴西 · 喜拉多 拼配",
            roaster="自有烘焙",
            origin={"country": "巴西", "region": "Minas Gerais"},
            process="washed",
            roast_level="medium_dark",
            roast_date=today - timedelta(days=18),
            weight_grams=500,
            remaining_grams=80,
            tags=["意式"],
            notes="用于意式，坚果与可可为主",
        ),
    ]
    for bean in beans:
        db.session.add(bean)
    db.session.flush()
    counts["beans"] = len(beans)

    ethiopia, colombia, brazil = beans[0].id, beans[1].id, beans[2].id

    brews = [
        _build_brew(
            ethiopia,
            "pour_over_v60",
            15,
            250,
            168,
            93,
            {"acidity": 8, "sweetness": 4, "body": 4, "flavor": 7, "aftertaste": 4, "balance": 5},
            "前段有明显柑橘酸，尾段发苦，余韵偏短",
            2,
        ),
        _build_brew(
            ethiopia,
            "pour_over_v60",
            15,
            260,
            155,
            94,
            {"acidity": 6, "sweetness": 7, "body": 4, "flavor": 8, "aftertaste": 7, "balance": 7},
            "磨细一格后甜感上来了，柑橘与白桃",
            1,
        ),
        _build_brew(
            brazil,
            "espresso",
            18,
            40,
            29,
            93,
            {"acidity": 4, "sweetness": 6, "body": 8, "flavor": 6, "aftertaste": 6, "balance": 7},
            "坚果与可可，crema 厚实",
            1,
        ),
        _build_brew(
            colombia,
            "french_press",
            15,
            250,
            240,
            91,
            {"acidity": 3, "sweetness": 7, "body": 8, "flavor": 5, "aftertaste": 6, "balance": 5},
            "醇厚带油，莓果甜感好",
            3,
        ),
    ]
    counts["brews"] = len(brews)

    events = [
        {"type": "charge", "atSecond": 0, "temperature": 205},
        {"type": "turningPoint", "atSecond": 78, "temperature": 108},
        {"type": "dryEnd", "atSecond": 240, "temperature": 158},
        {"type": "firstCrack", "atSecond": 348, "temperature": 201},
        {"type": "drop", "atSecond": 512, "temperature": 216},
    ]
    roast = RoastBatch(
        id=new_id("rb"),
        bean_id=ethiopia,
        batch_no="2026-1110-A",
        roaster="Aillio Bullet R2",
        green_grams=500,
        out_grams=425,
        weight_loss_percent=15.0,
        total_seconds=512,
        events=events,
        dtr_percent=32.0,
        phase_ratio={"drying": 46.9, "maillard": 21.1, "development": 32},
        cupping_score=86.5,
        notes="梅纳期偏长，发展比略高，甜感好但酸质略钝",
        roast_date=utcnow() - timedelta(days=13),
    )
    db.session.add(roast)
    db.session.flush()
    db.session.add(
        RoastCurve(
            id=new_id("cv"),
            roast_id=roast.id,
            source="keypoint",
            points=roast_domain.generate_roast_curve(events, 512),
            events=events,
            meta={"generator": "monotone-cubic-v1"},
        )
    )
    counts["roasts"] = 1

    equipment_rows: List[Dict[str, Any]] = [
        {"type": "grinder", "name": "EK43", "brand": "Fellow", "model": "EK43 S", "notes": "#22 约 0.8mm，粗细以刻度计"},
        {"type": "grinder", "name": "Rosso 绞磨", "brand": "Home", "model": "Rosso R2", "notes": "刻度 0-40，越大越细"},
        {"type": "dripper", "name": "V60 02 滤杯", "brand": "Hario", "model": "02 陶瓷"},
        {"type": "dripper", "name": "Kalita Wave 185", "brand": "Kalita", "model": "Wave 185 灰"},
        {"type": "brewer", "name": "细口手冲壶", "brand": "Fellow", "model": "Stagg EKG", "notes": "控温 92℃"},
        {"type": "scale", "name": "电子秤", "brand": "TIMEMORE", "model": "Black Series", "notes": "0.1g 精度，蓝牙连接"},
        {"type": "espresso", "name": "半自动咖啡机", "brand": "ECM", "model": "Synchronika", "notes": "E61 冲煮头，58mm 粉碗"},
        {"type": "roaster", "name": "烘豆机", "brand": "Aillio", "model": "Bullet R2"},
    ]
    for row in equipment_rows:
        db.session.add(Equipment(id=new_id("eq"), **row))
    counts["equipment"] = len(equipment_rows)

    db.session.commit()
    return counts
