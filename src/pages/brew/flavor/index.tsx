import { useMemo } from 'react'
import { View, Text, Slider, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { METHOD_MAP } from '../../../domain/methods'
import {
  FLAVOR_AXIS_KEYS,
  FLAVOR_AXIS_LABELS,
  type FlavorAxes,
  type FlavorProfile
} from '../../../domain/types'
import {
  FLAVOR_CATEGORIES,
  FLAVOR_DEFECTS,
  TEMP_STAGE_LABELS,
  descriptorsForCategories
} from '../../../domain/flavor'
import { diagnose, describeDeviation } from '../../../domain/diagnosis'
import { useBrewDraft } from '../../../store/useBrewDraft'
import FlavorRadar from '../../../components/chart/FlavorRadar'
import Markdown from '../../../components/markdown'
import { pickImages } from '../../../platform/image'
import { uploadBrewImage } from '../../../services/uploads'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'

const DEPTHS: { id: 'quick' | 'standard' | 'cupping'; label: string; hint: string }[] = [
  { id: 'quick', label: '快速', hint: '只打六轴，10 秒完成' },
  { id: 'standard', label: '标准', hint: '六轴 + 风味词 + 温度段' },
  { id: 'cupping', label: '杯测', hint: '全部词库 + 缺陷标记 + 整体印象' }
]

export default function FlavorPage() {
  const { themeClass } = useResolvedTheme()
  const draft = useBrewDraft(s => s.draft)
  const setAxis = useBrewDraft(s => s.setAxis)
  const toggleDescriptor = useBrewDraft(s => s.toggleDescriptor)
  const toggleDefect = useBrewDraft(s => s.toggleDefect)
  const setTempStage = useBrewDraft(s => s.setTempStage)
  const setNote = useBrewDraft(s => s.setNote)
  const setReview = useBrewDraft(s => s.setReview)
  const addImage = useBrewDraft(s => s.addImage)
  const removeImage = useBrewDraft(s => s.removeImage)
  const setDepth = useBrewDraft(s => s.setDepth)

  /** 选图 → 上传（存储由后端提供）→ 关联到本次记录 */
  const addImages = async () => {
    try {
      const picked = await pickImages(6)
      if (!picked.length) return
      Taro.showLoading({ title: '上传中' })
      for (const p of picked) {
        const img = await uploadBrewImage(p.path, p.size)
        addImage(img)
      }
      Taro.hideLoading()
      Taro.showToast({ title: `已添加 ${picked.length} 张`, icon: 'none' })
    } catch (e) {
      Taro.hideLoading()
      Taro.showToast({ title: '上传失败', icon: 'none' })
    }
  }

  const method = METHOD_MAP[draft.methodId]

  const flavorProfile: FlavorProfile = useMemo(
    () => ({
      axes: draft.axes,
      descriptors: draft.descriptors,
      defects: draft.defects,
      tempStage: draft.tempStage,
      overall: Number(
        (
          FLAVOR_AXIS_KEYS.reduce((s, k) => s + draft.axes[k], 0) /
          FLAVOR_AXIS_KEYS.length
        ).toFixed(1)
      ),
      note: draft.note
    }),
    [draft.axes, draft.descriptors, draft.defects, draft.tempStage, draft.note]
  )

  const diagnosis = useMemo(
    () => (method ? diagnose(method, flavorProfile) : null),
    [method, flavorProfile]
  )

  // 词库范围：标准档只显示该方式推荐的子类，杯测档显示全部
  const descriptorPool = useMemo(() => {
    if (draft.depth === 'cupping') {
      const all: { id: string; label: string; category: string; categoryLabel: string }[] = []
      FLAVOR_CATEGORIES.forEach(c =>
        c.subcategories.forEach(s =>
          s.descriptors.forEach(d =>
            all.push({ id: d.id, label: d.label, category: c.id, categoryLabel: c.label })
          )
        )
      )
      return all
    }
    if (draft.depth === 'standard') {
      return descriptorsForCategories(method?.flavorCategories ?? [])
    }
    return []
  }, [draft.depth, method])

  if (!method || !diagnosis) {
    return (
      <View className={`page ${themeClass}`}>
        <View className="empty">请先选择冲煮方式</View>
      </View>
    )
  }

  const activeIds = new Set(draft.descriptors.map(d => d.id))
  const activeDefectIds = new Set(draft.defects.map(d => d.id))

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">FLAVOR LOG</Text>
        <Text className="page__title">风味记录</Text>
        <Text className="dim method-sub">
          基线来自「{method.name}」的目标风味，偏差会直接给出下一杯的调整处方
        </Text>
      </View>

      <View className="page__body">
        {/* 深度档位 */}
        <View className="segmented">
          {DEPTHS.map(d => (
            <View
              key={d.id}
              className={draft.depth === d.id ? 'segmented__item segmented__item--active' : 'segmented__item'}
              onClick={() => setDepth(d.id)}
            >
              <Text className="segmented__label">{d.label}</Text>
              <Text className="segmented__hint">{d.hint}</Text>
            </View>
          ))}
        </View>

        {/* 雷达：基线 vs 实测 */}
        <View className="radar-wrap">
          <FlavorRadar actual={flavorProfile.axes} baseline={diagnosis.baseline} size={280} />
          <View className="legend">
            <View className="legend__item">
              <View className="legend__swatch legend__swatch--base" />
              <Text className="mute">目标基线</Text>
            </View>
            <View className="legend__item">
              <View className="legend__swatch legend__swatch--actual" />
              <Text className="mute">本次实测</Text>
            </View>
          </View>
        </View>

        {/* 六轴评分 */}
        <View className="block">
          <Text className="section-title">六轴评分</Text>
          {FLAVOR_AXIS_KEYS.map(k => {
            const value = draft.axes[k]
            const base = diagnosis.baseline[k]
            const diff = value - base
            return (
              <View className="axis" key={k}>
                <View className="axis__head">
                  <Text className="axis__label">{FLAVOR_AXIS_LABELS[k]}</Text>
                  <Text className="axis__base mono">基线 {base}</Text>
                  <Text className={diff >= 0 ? 'axis__value mono' : 'axis__value axis__value--low mono'}>
                    {value}
                  </Text>
                </View>
                <Slider
                  className="axis__slider"
                  min={0}
                  max={10}
                  step={1}
                  value={value}
                  activeColor="#7FD1C1"
                  backgroundColor="#242927"
                  blockColor="#E8EDE8"
                  blockSize={16}
                  onChanging={e => setAxis(k as keyof FlavorAxes, e.detail.value)}
                  onChange={e => setAxis(k as keyof FlavorAxes, e.detail.value)}
                />
              </View>
            )
          })}
        </View>

        {/* 温度段 */}
        {draft.depth !== 'quick' && (
          <View className="block">
            <Text className="section-title">品饮温度段</Text>
            <View className="chips">
              {(Object.keys(TEMP_STAGE_LABELS) as (keyof typeof TEMP_STAGE_LABELS)[]).map(t => (
                <View
                  key={t}
                  className={draft.tempStage === t ? 'tag tag--active' : 'tag'}
                  onClick={() => setTempStage(t)}
                >
                  {TEMP_STAGE_LABELS[t]}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 风味词 */}
        {draft.depth !== 'quick' && (
          <View className="block">
            <Text className="section-title">风味描述</Text>
            <Text className="mute block__hint">
              {draft.depth === 'standard'
                ? '已按该方式筛选推荐词库，切换到杯测档可看全部'
                : 'SCA 风味轮全部描述词'}
            </Text>
            <View className="chips">
              {descriptorPool.map(d => (
                <View
                  key={d.id}
                  className={activeIds.has(d.id) ? 'tag tag--active' : 'tag'}
                  onClick={() => toggleDescriptor(d)}
                >
                  {d.label}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 缺陷 */}
        {draft.depth === 'cupping' && (
          <View className="block">
            <Text className="section-title">缺陷标记</Text>
            <View className="chips">
              {FLAVOR_DEFECTS.map(d => (
                <View
                  key={d.id}
                  className={activeDefectIds.has(d.id) ? 'tag tag--danger' : 'tag'}
                  onClick={() => toggleDefect(d)}
                >
                  {d.label}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 风味备注 */}
        <View className="block">
          <Text className="section-title">风味备注</Text>
          <Text className="mute block__hint">
            支持 Markdown：标题、粗体、斜体、列表、引用
          </Text>
          <Textarea
            className="note"
            value={draft.note}
            placeholder="例如：前段有明显柑橘酸，尾段发苦，余韵偏短"
            onInput={e => setNote(e.detail.value)}
          />
          {!!draft.note.trim() && (
            <View className="note-preview">
              <Text className="mute note-preview__label">预览</Text>
              <Markdown source={draft.note} compact />
            </View>
          )}
        </View>

        {/* 评鉴内容 */}
        <View className="block">
          <Text className="section-title">评鉴内容</Text>
          <Text className="mute block__hint">
            记录杯中表现、与目标风味的差距、下一杯的调整想法
          </Text>
          <Textarea
            className="note note--tall"
            value={draft.review}
            placeholder="例如：这杯整体偏薄，缺少甜感支撑；下次把研磨调细半格、水温提到 94℃，闷蒸延长到 50 秒，看看酸甜能否平衡。"
            onInput={e => setReview(e.detail.value)}
          />
          {!!draft.review.trim() && (
            <View className="note-preview">
              <Text className="mute note-preview__label">预览</Text>
              <Markdown source={draft.review} compact />
            </View>
          )}
        </View>

        {/* 图片备注 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">图片备注</Text>
            <Text className="mute" onClick={addImages}>
              + 添加图片
            </Text>
          </View>
          {draft.images.length ? (
            <View className="img-grid">
              {draft.images.map(img => (
                <View className="img-grid__item" key={img.id}>
                  <Image className="img-grid__img" src={img.url} mode="aspectFill" />
                  <Text
                    className="img-grid__remove"
                    onClick={() => removeImage(img.id)}
                  >
                    ×
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty empty--inline">
              还没有图片。粉层状态、干豆、杯中表现都可以拍下来作为备注
            </View>
          )}
        </View>

        {/* 诊断结论 */}
        <View className="block">
          <Text className="section-title">诊断</Text>
          <View className="diag">
            <View className="diag__head">
              <Text className="diag__verdict">{diagnosis.verdictLabel}</Text>
              <Text className="diag__score mono">吻合 {diagnosis.matchScore}%</Text>
            </View>

            {diagnosis.deviations.length > 0 && (
              <View className="diag__deviations">
                {diagnosis.deviations.map(d => (
                  <Text className="diag__deviation" key={d.axis}>
                    {describeDeviation(d)}
                  </Text>
                ))}
              </View>
            )}

            <View className="divider" />

            {diagnosis.prescriptions.map(p => (
              <View className="rx" key={p.action + p.priority}>
                <View className="rx__index mono">{String(p.priority).padStart(2, '0')}</View>
                <View className="rx__body">
                  <Text className="rx__label">
                    {p.label}
                    {p.delta ? <Text className="rx__delta"> {p.delta}</Text> : null}
                  </Text>
                  <Text className="mute rx__reason">{p.reason}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View className="actions">
          <View
            className="btn btn--primary"
            onClick={() => Taro.navigateTo({ url: '/pages/brew/detail/index' })}
          >
            查看曲线与详情
          </View>
        </View>
      </View>
    </View>
  )
}
