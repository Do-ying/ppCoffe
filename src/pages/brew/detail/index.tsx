import { useMemo, useState } from 'react'
import { View, Text, Image, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { METHOD_MAP } from '../../../domain/methods'
import { diagnose } from '../../../domain/diagnosis'
import { FLAVOR_AXIS_KEYS, type FlavorProfile } from '../../../domain/types'
import { useBrewDraft, draftCurve } from '../../../store/useBrewDraft'
import CurveChart from '../../../components/chart/CurveChart'
import FlavorRadar from '../../../components/chart/FlavorRadar'
import Markdown from '../../../components/markdown'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'
import BackBar from '../../../components/back-bar'

export default function BrewDetailPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const id = router.params.id
  const draft = useBrewDraft(s => s.draft)
  const reset = useBrewDraft(s => s.reset)
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [editingNotes, setEditingNotes] = useState<{ note: string; review: string }>()

  const { data: record, isError } = useQuery({
    queryKey: ['brew', id],
    queryFn: () => api.getBrew(id as string),
    enabled: !!id
  })

  const beanId = id ? record?.beanId : draft.beanId
  const roastBatchId = id ? record?.roastBatchId : draft.roastBatchId
  const { data: bean } = useQuery({
    queryKey: ['bean', beanId],
    queryFn: () => api.getBean(beanId as string),
    enabled: !!beanId
  })
  const { data: roast } = useQuery({
    queryKey: ['roast', roastBatchId],
    queryFn: () => api.getRoast(roastBatchId as string),
    enabled: !!roastBatchId
  })
  const { data: equipmentList } = useQuery({
    queryKey: ['equipment'],
    queryFn: api.listEquipment
  })

  // 有 id 走已保存记录，否则用当前草稿
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
        overall: Number((FLAVOR_AXIS_KEYS.reduce((sum, key) => sum + draft.axes[key], 0) /
          FLAVOR_AXIS_KEYS.length).toFixed(1)),
        note: draft.note
      }
  const params = record?.params ?? draft.params

  const diagnosis = useMemo(
    () => (method ? diagnose(method, flavor) : null),
    [method, flavor]
  )

  const equipmentNames = useMemo(() => {
    const ids = record ? record.equipmentIds ?? [] : draft.equipmentIds
    return (equipmentList?.items ?? [])
      .filter(e => ids.includes(e.id))
      .map(e => e.name)
  }, [record, draft.equipmentIds, equipmentList])

  const reviewText = record ? record.review : draft.review
  const noteText = record ? record.flavor.note ?? record.notes : draft.note
  const images = record ? record.images ?? [] : draft.images

  const save = async () => {
    if (saving || !draft.beanId) return
    setSaving(true)
    try {
      const created = await api.createBrew({
        beanId: draft.beanId,
        roastBatchId: draft.roastBatchId,
        method: draft.methodId,
        equipmentIds: draft.equipmentIds,
        params: draft.params,
        steps: draft.steps,
        flavor,
        notes: draft.note,
        review: draft.review,
        images: draft.images
      })
      queryClient.setQueryData(['brew', created.id], created)
      void queryClient.invalidateQueries({ queryKey: ['brews'] })
      void queryClient.invalidateQueries({ queryKey: ['beanBrews', draft.beanId] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
      Taro.showToast({ title: '已保存', icon: 'success' })
      await Taro.redirectTo({ url: `/pages/brew/detail/index?id=${created.id}` })
      reset()
    } catch (error: unknown) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }
  const saveNotes = async () => {
    if (!record || !editingNotes || saving) return
    setSaving(true)
    try {
      const updated = await api.updateBrew(record.id, {
        flavor: { ...record.flavor, note: editingNotes.note },
        notes: editingNotes.note,
        review: editingNotes.review
      })
      queryClient.setQueryData(['brew', record.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['brews'] })
      void queryClient.invalidateQueries({ queryKey: ['beanBrews', record.beanId] })
      setEditingNotes(undefined)
    } catch (error: unknown) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  if (id && !record) {
    return (
      <View className={`page ${themeClass}`}>
        <BackBar fallback="/pages/brew/list/index" />
        <View className="empty">{isError ? '读取冲煮记录失败' : '加载中…'}</View>
      </View>
    )
  }

  if (!method) {
    return (
      <View className={`page ${themeClass}`}>
        <BackBar fallback="/pages/brew/list/index" />
        <View className="empty">数据不完整</View>
      </View>
    )
  }

  const stats = {
    duration: curve.points.length ? curve.points[curve.points.length - 1].t : 0,
    finalWeight: curve.points.length ? curve.points[curve.points.length - 1].w : 0
  }

  return (
    <View className={`page ${themeClass}`}>
      <BackBar fallback="/pages/brew/list/index" />
      <View className="page__header">
        <Text className="eyebrow">{method.name.toUpperCase()}</Text>
        <Text className="page__title">{bean?.name ?? '未指定豆子'}</Text>
        {record && (
          <Text className="dim method-sub">
            {new Date(record.brewDate).toLocaleDateString()}
          </Text>
        )}
        {roast && <Text className="dim method-sub">烘焙炉次 · {roast.batchNo}</Text>}
        {record && bean?.kind === 'green' && !record.roastBatchId && (
          <Text className="dim method-sub">烘焙炉次 · 历史未指定</Text>
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

        {editingNotes && (
          <View className="block">
            <Text className="section-title">编辑备注</Text>
            <View className="form">
              <View className="form__row form__row--block">
                <Text className="form__label">风味备注（Markdown）</Text>
                <Textarea
                  className="form__textarea"
                  value={editingNotes.note}
                  onInput={e => setEditingNotes({ ...editingNotes, note: e.detail.value })}
                />
              </View>
              <View className="form__row form__row--block">
                <Text className="form__label">评鉴内容（Markdown）</Text>
                <Textarea
                  className="form__textarea"
                  value={editingNotes.review}
                  onInput={e => setEditingNotes({ ...editingNotes, review: e.detail.value })}
                />
              </View>
            </View>
            <View className="actions">
              <View className="btn btn--primary" onClick={saving ? undefined : saveNotes}>
                {saving ? '保存中…' : '保存备注'}
              </View>
              <View className="btn btn--ghost" onClick={saving ? undefined : () => setEditingNotes(undefined)}>
                取消
              </View>
            </View>
          </View>
        )}

        {!!noteText?.trim() && !editingNotes && (
          <View className="block">
            <Text className="section-title">风味备注</Text>
            <View className="panel">
              <Markdown source={noteText} />
            </View>
          </View>
        )}

        {/* 评鉴内容 */}
        {!!reviewText?.trim() && !editingNotes && (
          <View className="block">
            <Text className="section-title">评鉴内容</Text>
            <View className="panel">
              <Markdown source={reviewText} />
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
        {record && !editingNotes && (
          <View className="actions">
            <View className="btn btn--ghost" onClick={() =>
              setEditingNotes({ note: noteText ?? '', review: reviewText ?? '' })
            }>编辑备注</View>
          </View>
        )}
        {!id && (
          <View className="actions">
            <View className="btn btn--primary" onClick={saving || !beanId ? undefined : save}>
              {saving ? '保存中…' : '保存冲煮记录'}
            </View>
          </View>
        )}
      </View>
    </View>
  )
}
