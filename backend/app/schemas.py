"""请求/响应校验 Schema（marshmallow）。

校验失败统一抛 422 ``VALIDATION_FAILED``，并在 ``error.field`` 指出出错字段，
前端 ``ApiRequestError`` 可直接用于表单定位。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from marshmallow import EXCLUDE, Schema, ValidationError, fields, validate

__all__ = [
    "BaseSchema",
    "FlavorAxesSchema",
    "FlavorDescriptorSchema",
    "FlavorDefectSchema",
    "FlavorProfileSchema",
    "BrewParamsSchema",
    "BrewStepSchema",
    "BrewCurveSchema",
    "BeanCreateSchema",
    "BeanUpdateSchema",
    "BrewCreateSchema",
    "BrewUpdateSchema",
    "RoastEventSchema",
    "RoastCurvePointSchema",
    "RoastCreateSchema",
    "RoastUpdateSchema",
    "RestEventCreateSchema",
    "RestEventUpdateSchema",
    "EquipmentCreateSchema",
    "EquipmentUpdateSchema",
    "RecipeCreateSchema",
    "RecipeUpdateSchema",
    "WechatAuthSchema",
    "RefreshSchema",
    "PresignSchema",
    "UploadCreateSchema",
    "DeriveCurveSchema",
    "CompareBrewsSchema",
    "CompareRoastsSchema",
    "RoastImportSchema",
]


class BaseSchema(Schema):
    """公共基类：忽略未知字段（前端先行发布新字段时不会 400）。"""

    class Meta:
        unknown = EXCLUDE


# --------------------------------------------------------------------- #
#  风味
# --------------------------------------------------------------------- #


class FlavorAxesSchema(BaseSchema):
    acidity = fields.Integer(required=True, validate=validate.Range(min=0, max=10))
    sweetness = fields.Integer(required=True, validate=validate.Range(min=0, max=10))
    body = fields.Integer(required=True, validate=validate.Range(min=0, max=10))
    flavor = fields.Integer(required=True, validate=validate.Range(min=0, max=10))
    aftertaste = fields.Integer(required=True, validate=validate.Range(min=0, max=10))
    balance = fields.Integer(required=True, validate=validate.Range(min=0, max=10))


class FlavorDescriptorSchema(BaseSchema):
    id = fields.String(required=True)
    label = fields.String(required=False, allow_none=True)
    category = fields.String(required=False, allow_none=True)
    intensity = fields.Integer(required=False, validate=validate.Range(min=0, max=10))
    tempStage = fields.String(required=False, validate=validate.OneOf(["hot", "warm", "cool"]))


class FlavorDefectSchema(BaseSchema):
    id = fields.String(required=True)
    label = fields.String(required=False, allow_none=True)
    severity = fields.Integer(required=False, validate=validate.Range(min=1, max=3))


class FlavorProfileSchema(BaseSchema):
    axes = fields.Nested(FlavorAxesSchema, required=False)
    descriptors = fields.List(fields.Nested(FlavorDescriptorSchema), required=False)
    defects = fields.List(fields.Nested(FlavorDefectSchema), required=False)
    tempStage = fields.String(
        required=False, validate=validate.OneOf(["hot", "warm", "cool"]), data_key="tempStage"
    )
    overall = fields.Float(required=False, validate=validate.Range(min=0, max=10))
    note = fields.String(required=False, allow_none=True)


# --------------------------------------------------------------------- #
#  冲煮
# --------------------------------------------------------------------- #


class BrewParamsSchema(BaseSchema):
    doseGrams = fields.Float(required=False, validate=validate.Range(min=0, max=2000))
    waterGrams = fields.Float(required=False, validate=validate.Range(min=0, max=10000))
    yieldGrams = fields.Float(required=False, validate=validate.Range(min=0, max=10000))
    brewSeconds = fields.Integer(required=False, validate=validate.Range(min=0, max=604800))
    temperature = fields.Float(required=False, validate=validate.Range(min=-20, max=120))
    grindSetting = fields.String(required=False, allow_none=True)
    grindValue = fields.Float(required=False, allow_none=True)
    preinfusionSeconds = fields.Integer(
        required=False, validate=validate.Range(min=0, max=600), allow_none=True
    )
    ratio = fields.Float(required=False, validate=validate.Range(min=0, max=100))
    waterTds = fields.Integer(required=False, allow_none=True)
    waterHardness = fields.Integer(required=False, allow_none=True)


class BrewStepSchema(BaseSchema):
    atSecond = fields.Integer(required=True, validate=validate.Range(min=0))
    toGrams = fields.Float(required=True, validate=validate.Range(min=0))
    label = fields.String(required=False, allow_none=True)
    stage = fields.String(
        required=False, validate=validate.OneOf(["preinfusion", "bloom", "extraction", "drawdown"])
    )


class BrewCurveSchema(BaseSchema):
    source = fields.String(
        required=False, validate=validate.OneOf(["plan", "keypoint", "device", "import", "live"])
    )
    points = fields.List(fields.Dict(), required=False)
    stages = fields.List(fields.Dict(), required=False)
    meta = fields.Dict(required=False)


class BrewImageSchema(BaseSchema):
    id = fields.String(required=False, allow_none=True)
    objectKey = fields.String(required=True)
    url = fields.String(required=False, allow_none=True)
    caption = fields.String(required=False, allow_none=True)
    width = fields.Integer(required=False, allow_none=True)
    height = fields.Integer(required=False, allow_none=True)
    sizeBytes = fields.Integer(required=False, allow_none=True)


class BrewCreateSchema(BaseSchema):
    beanId = fields.String(required=True)
    roastBatchId = fields.String(required=False, allow_none=True)
    method = fields.String(required=True)
    equipmentIds = fields.List(fields.String(), required=False)
    params = fields.Nested(BrewParamsSchema, required=False)
    steps = fields.List(fields.Nested(BrewStepSchema), required=False)
    curve = fields.Nested(BrewCurveSchema, required=False)
    flavor = fields.Nested(FlavorProfileSchema, required=False)
    notes = fields.String(required=False, allow_none=True)
    review = fields.String(required=False, allow_none=True)
    images = fields.List(fields.Nested(BrewImageSchema), required=False)
    brewDate = fields.String(required=False, allow_none=True)


class BrewUpdateSchema(BaseSchema):
    beanId = fields.String(required=False)
    roastBatchId = fields.String(required=False, allow_none=True)
    method = fields.String(required=False)
    equipmentIds = fields.List(fields.String(), required=False)
    params = fields.Nested(BrewParamsSchema, required=False)
    steps = fields.List(fields.Nested(BrewStepSchema), required=False)
    curve = fields.Nested(BrewCurveSchema, required=False)
    flavor = fields.Nested(FlavorProfileSchema, required=False)
    notes = fields.String(required=False, allow_none=True)
    review = fields.String(required=False, allow_none=True)
    images = fields.List(fields.Nested(BrewImageSchema), required=False)
    brewDate = fields.String(required=False, allow_none=True)


# --------------------------------------------------------------------- #
#  豆子
# --------------------------------------------------------------------- #


class OriginSchema(BaseSchema):
    country = fields.String(required=False, allow_none=True)
    region = fields.String(required=False, allow_none=True)
    farm = fields.String(required=False, allow_none=True)
    altitudeMasl = fields.Integer(required=False, allow_none=True)
    variety = fields.String(required=False, allow_none=True)


class BeanCreateSchema(BaseSchema):
    name = fields.String(required=True)
    roaster = fields.String(required=False, allow_none=True)
    origin = fields.Nested(OriginSchema, required=False)
    process = fields.String(
        required=False, validate=validate.OneOf(["washed", "natural", "honey", "anaerobic", "other"])
    )
    roastLevel = fields.String(
        required=False, validate=validate.OneOf(["light", "medium", "medium_dark", "dark"])
    )
    agtron = fields.Integer(required=False, allow_none=True)
    roastDate = fields.String(required=False, allow_none=True)
    weightGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    remainingGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    tags = fields.List(fields.String(), required=False)
    imageUrl = fields.String(required=False, allow_none=True)
    notes = fields.String(required=False, allow_none=True)
    #: 豆子类型：purchased_roasted 成品豆 / green 生豆
    kind = fields.String(
        required=False, allow_none=True,
        validate=validate.OneOf(["purchased_roasted", "green"]),
    )
    #: 实付豆款，单位「分」；None 表示未填写采购价，0 表示明确填了 0 元
    purchaseCostCents = fields.Integer(required=False, allow_none=True, validate=validate.Range(min=0, max=2147483647))
    #: 封面图对象键（对象存储）
    sourceFileKey = fields.String(required=False, allow_none=True)


class BeanUpdateSchema(BaseSchema):
    name = fields.String(required=False)
    roaster = fields.String(required=False, allow_none=True)
    origin = fields.Nested(OriginSchema, required=False)
    process = fields.String(
        required=False, validate=validate.OneOf(["washed", "natural", "honey", "anaerobic", "other"])
    )
    roastLevel = fields.String(
        required=False, validate=validate.OneOf(["light", "medium", "medium_dark", "dark"])
    )
    agtron = fields.Integer(required=False, allow_none=True)
    roastDate = fields.String(required=False, allow_none=True)
    weightGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    remainingGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    tags = fields.List(fields.String(), required=False)
    imageUrl = fields.String(required=False, allow_none=True)
    notes = fields.String(required=False, allow_none=True)
    kind = fields.String(
        required=False, allow_none=True,
        validate=validate.OneOf(["purchased_roasted", "green"]),
    )
    purchaseCostCents = fields.Integer(required=False, allow_none=True, validate=validate.Range(min=0, max=2147483647))
    sourceFileKey = fields.String(required=False, allow_none=True)


# --------------------------------------------------------------------- #
#  烘豆
# --------------------------------------------------------------------- #


class RoastEventSchema(BaseSchema):
    type = fields.String(
        required=True,
        validate=validate.OneOf(["charge", "turningPoint", "dryEnd", "firstCrack", "drop"]),
    )
    atSecond = fields.Integer(required=True, validate=validate.Range(min=0))
    temperature = fields.Float(required=True)


class RoastCurvePointSchema(BaseSchema):
    t = fields.Integer(required=True, validate=validate.Range(min=0))
    bt = fields.Float(required=True)
    et = fields.Float(required=False, allow_none=True)
    ror = fields.Float(required=False, allow_none=True)


class RoastCreateSchema(BaseSchema):
    beanId = fields.String(required=True)
    batchNo = fields.String(required=True)
    submissionId = fields.String(validate=validate.Length(min=1, max=64))
    roaster = fields.String(required=False, allow_none=True)
    greenGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    outGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    totalSeconds = fields.Integer(required=False, validate=validate.Range(min=0))
    events = fields.List(fields.Nested(RoastEventSchema), required=False)
    curve = fields.List(fields.Nested(RoastCurvePointSchema), required=False)
    cuppingScore = fields.Float(required=False, validate=validate.Range(min=0, max=100))
    roastLevel = fields.String(
        required=False, allow_none=True,
        validate=validate.OneOf(["light", "medium", "medium_dark", "dark"]),
    )
    notes = fields.String(required=False, allow_none=True)
    roastDate = fields.String(required=False, allow_none=True)
    targetProfileId = fields.String(required=False, allow_none=True)


class RestEventCreateSchema(BaseSchema):
    """养豆事件录入。

    ``beanId`` 从 URL 路径取，不在请求体里重复传。

    ``roastBatchId``：生豆（kind=green）必填 —— 事件挂在具体炉次上；
    成品豆（kind=purchased_roasted）留空 —— 事件挂在购入批次上。
    """

    roastBatchId = fields.String(required=False, allow_none=True)
    type = fields.String(
        required=True, validate=validate.OneOf(["opened", "sealed", "divided", "note"])
    )
    occurredAt = fields.String(required=False, allow_none=True)
    note = fields.String(required=False, allow_none=True)


class RestEventUpdateSchema(BaseSchema):
    """养豆事件更正。"""

    roastBatchId = fields.String(required=False, allow_none=True)
    type = fields.String(
        required=False, validate=validate.OneOf(["opened", "sealed", "divided", "note"])
    )
    occurredAt = fields.String(required=False, allow_none=True)
    note = fields.String(required=False, allow_none=True)


class RoastUpdateSchema(BaseSchema):
    beanId = fields.String(required=False)
    batchNo = fields.String(required=False)
    roaster = fields.String(required=False, allow_none=True)
    greenGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    outGrams = fields.Integer(required=False, validate=validate.Range(min=0))
    totalSeconds = fields.Integer(required=False, validate=validate.Range(min=0))
    events = fields.List(fields.Nested(RoastEventSchema), required=False)
    curve = fields.List(fields.Nested(RoastCurvePointSchema), required=False)
    cuppingScore = fields.Float(required=False, validate=validate.Range(min=0, max=100))
    roastLevel = fields.String(
        required=False, allow_none=True,
        validate=validate.OneOf(["light", "medium", "medium_dark", "dark"]),
    )
    notes = fields.String(required=False, allow_none=True)
    roastDate = fields.String(required=False, allow_none=True)
    targetProfileId = fields.String(required=False, allow_none=True)


# --------------------------------------------------------------------- #
#  器具 / 配方
# --------------------------------------------------------------------- #


class EquipmentCreateSchema(BaseSchema):
    type = fields.String(
        required=True,
        validate=validate.OneOf(
            ["grinder", "dripper", "brewer", "espresso", "scale", "roaster", "other"]
        ),
    )
    name = fields.String(required=True)
    brand = fields.String(required=False, allow_none=True)
    model = fields.String(required=False, allow_none=True)
    notes = fields.String(required=False, allow_none=True)


class EquipmentUpdateSchema(BaseSchema):
    type = fields.String(
        required=False,
        validate=validate.OneOf(
            ["grinder", "dripper", "brewer", "espresso", "scale", "roaster", "other"]
        ),
    )
    name = fields.String(required=False)
    brand = fields.String(required=False, allow_none=True)
    model = fields.String(required=False, allow_none=True)
    notes = fields.String(required=False, allow_none=True)


class RecipeCreateSchema(BaseSchema):
    name = fields.String(required=True)
    method = fields.String(required=True)
    params = fields.Nested(BrewParamsSchema, required=False)
    steps = fields.List(fields.Nested(BrewStepSchema), required=False)
    notes = fields.String(required=False, allow_none=True)
    favorite = fields.Boolean(required=False)


class RecipeUpdateSchema(BaseSchema):
    name = fields.String(required=False)
    method = fields.String(required=False)
    params = fields.Nested(BrewParamsSchema, required=False)
    steps = fields.List(fields.Nested(BrewStepSchema), required=False)
    notes = fields.String(required=False, allow_none=True)
    favorite = fields.Boolean(required=False)


# --------------------------------------------------------------------- #
#  认证 / 上传 / 派生计算
# --------------------------------------------------------------------- #


class WechatAuthSchema(BaseSchema):
    code = fields.String(required=True)
    nickname = fields.String(required=False, allow_none=True)
    avatarUrl = fields.String(required=False, allow_none=True)


class RefreshSchema(BaseSchema):
    refreshToken = fields.String(required=True)


class PresignSchema(BaseSchema):
    filename = fields.String(required=True)
    contentType = fields.String(required=False, allow_none=True)
    sizeBytes = fields.Integer(required=False, allow_none=True)
    #: 用途前缀：brew（冲煮附图）/ roast（烘焙记录）/ bean（豆子封面）
    purpose = fields.String(required=False, validate=validate.OneOf(["brew", "roast", "bean"]))


class UploadCreateSchema(BaseSchema):
    filename = fields.String(required=True)
    dataUri = fields.String(required=False, allow_none=True)
    sizeBytes = fields.Integer(required=False, allow_none=True)
    contentType = fields.String(required=False, allow_none=True)
    caption = fields.String(required=False, allow_none=True)
    #: 用途前缀：brew（冲煮附图）/ bean（豆子封面）
    purpose = fields.String(required=False, allow_none=True)


class KeypointSchema(BaseSchema):
    t = fields.Float(required=True, validate=validate.Range(min=0))
    w = fields.Float(required=True, validate=validate.Range(min=0))


class DeriveCurveSchema(BaseSchema):
    method = fields.String(required=True)
    mode = fields.String(required=False, validate=validate.OneOf(["plan", "keypoint"]))
    params = fields.Dict(required=False)
    steps = fields.List(fields.Nested(BrewStepSchema), required=False)
    keypoints = fields.List(fields.Nested(KeypointSchema), required=False)


class CompareBrewsSchema(BaseSchema):
    brewIds = fields.List(fields.String(), required=True, validate=validate.Length(min=1, max=10))


class CompareRoastsSchema(BaseSchema):
    roastIds = fields.List(fields.String(), required=True, validate=validate.Length(min=1, max=10))


class RoastImportSchema(BaseSchema):
    format = fields.String(
        required=True, validate=validate.OneOf(["artisan_alog", "csv", "roest_url"])
    )
    beanId = fields.String(required=True)
    payload = fields.String(required=False, allow_none=True)
    url = fields.String(required=False, allow_none=True)
    mapping = fields.Dict(required=False, allow_none=True)
    batchNo = fields.String(required=False, allow_none=True)
    roaster = fields.String(required=False, allow_none=True)
    greenGrams = fields.Integer(required=False, allow_none=True)
    outGrams = fields.Integer(required=False, allow_none=True)
    roastLevel = fields.String(validate=validate.OneOf(["light", "medium", "medium_dark", "dark"]))
    roastDate = fields.String()
