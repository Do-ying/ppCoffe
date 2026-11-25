import { useMemo } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import { METHOD_MAP } from '../../../domain/methods'
import { diagnose } from '../../../domain/diagnosis'
import type { BrewRecord, FlavorProfile } from '../../../domain/types'
import { useBrewDraft, draftCurve } from '../../../store/useBrewDraft'
import CurveChart from '../../../components/chart/CurveChart'
import FlavorRadar from '../../../components/chart/FlavorRadar'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'

export default function BrewDetailPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const id = router.params.id
  const draft = useBrewDraft(s => s.draft)

  const { data: saved } = useQuery({
    queryKey: ['brew', id],
    queryFn: () => api.getBrew(id as string),
    enabled: !!id
  })

  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: equipmentList } = useQuery({
    queryKey: ['equipment'],
    queryFn: api.listEquipment
  })

  // 有 id 走已保存记录，否则用当前草稿
  const record: BrewRecord | undefined = saved
  const methodId = record?.method ?? draft.methodId
  const method = METHOD_MAP[methodId]
  const curve = record ? record.curve : draftCurve(draft)
  const flavor: FlavorProfile = record
    ? record.flavor
    : {
        axes: draft.axes,
        descriptors: draft.descriptors,
        defects: draft.defects,
        tempStage: draft.tempStage,
        overall: 0,
        note: draft.note
      }
  const params = record?.params ?? draft.params

  const diagnosis = useMemo(
    () => (method ? diagnose(method, flavor) : null),
    [method, flavor]
  )

  const bean = beans?.items.find(b => b.id === (record?.beanId ?? draft.beanId))

  const equipmentNames = useMemo(() => {
    const ids = record?.equipmentIds ?? draft.equipmentIds
    return (equipmentList?.items ?? [])
      .filter(e => ids.includes(e.id))
      .map(e => e.name)
  }, [record?.equipmentIds, draft.equipmentIds, equipmentList])

  const reviewText = record?.review ?? draft.review
  const images = record?.images ?? draft.images

  if (!method) {
    return (
      <View className={`page ${themeClass}`}>
        <View className="empty">数据不完整</View>
      </View>
    )
  }

  const stats = {
    duration: curve.points.length ? curve.points[curve.points.length - 1].t : 0,
    finalWeight: curve.points.length ? curve.points[curve.points.length - 1].w : 0
  }

  return (
    <View className="page">
      <View className="page__header">
        <Text className="eyebrow">{method.name.toUpperCase()}</Text>
        <Text className="page__title">{bean?.name ?? '未指定豆子'}</Text>
        {record && (
          <Text className="dim method-sub">
            {new Date(record.brewDate).toLocaleDateString()} · {record.notes || '无备注'}
          </Text>
        )}
      </View>

      <View className="page__body">
        {/* 参数 */}
        <View className="panel">
          <View className="data-row">
            <Text className="data-row__label">粉量</Text>
            <Text className="data-row__value">{params.doseGrams} g</Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">注水量</Text>
            <Text className="data-row__value">{params.waterGrams} g</Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">粉水比</Text>
            <Text className="data-row__value">
              1 : {params.ratio?.toFixed(2) ?? '—'}
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">总时长</Text>
            <Text className="data-row__value">{params.brewSeconds} s</Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">水温</Text>
            <Text className="data-row__value">{params.temperature} ℃</Text>
          </View>
          {params.grindSetting && (
            <View className="data-row">
              <Text className="data-row__label">研磨</Text>
              <Text className="data-row__value">{params.grindSetting}</Text>
            </View>
          )}
          {!!equipmentNames.length && (
            <View className="data-row">
              <Text className="data-row__label">器具</Text>
              <Text className="data-row__value">{equipmentNames.join(' · ')}</Text>
            </View>
          )}
        </View>

        {/* 评鉴内容 */}
        {reviewText && (
          <View className="block">
            <Text className="section-title">评鉴内容</Text>
            <View className="panel">
              <Text className="review-text">{reviewText}</Text>
            </View>
          </View>
        )}

        {/* 图片备注 */}
        {!!images.length && (
          <View className="block">
            <Text className="section-title">图片备注</Text>
            <View className="img-grid">
              {images.map(img => (
                <View className="img-grid__item" key={img.id}>
                  <Image className="img-grid__img" src={img.url} mode="aspectFill" />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 曲线 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">冲煮曲线</Text>
            <Text className="mono mute">
              {stats.duration}s · {stats.finalWeight}g
            </Text>
          </View>
          <View className="chart-box">
            <CurveChart points={curve.points} stages={curve.stages} height={240} showFlow />
          </View>
          <View className="stage-legend">
            {curve.stages.map((s, i) => (
              <View className="stage-legend__item" key={`${s.from}-${i}`}>
                <View
                  className="stage-legend__dot"
                  style={{ background: ['#7FD1C1', '#5FA8A0', '#E9B44C', '#6C9BD1'][i % 4] }}
                />
                <Text className="mute">{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 风味雷达 */}
        {diagnosis && (
          <View className="block">
            <Text className="section-title">风味对照</Text>
            <View className="radar-wrap">
              <FlavorRadar actual={flavor.axes} baseline={diagnosis.baseline} size={280} />
            </View>
            <View className="panel">
              <View className="data-row">
                <Text className="data-row__label">判定</Text>
                <Text className="data-row__value">{diagnosis.verdictLabel}</Text>
              </View>
              <View className="data-row">
                <Text className="data-row__label">与基线吻合度</Text>
                <Text className="data-row__value">{diagnosis.matchScore} %</Text>
              </View>
              {diagnosis.prescriptions.slice(0, 3).map(p => (
                <View className="data-row" key={p.action}>
                  <Text className="data-row__label">{p.label}</Text>
                  <Text className="data-row__value">{p.delta ?? '—'}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  )
}
