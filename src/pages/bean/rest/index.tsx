import { useState } from 'react'
import { View, Text, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS, type RestEvent, type RestEventType } from '../../../domain/types'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

const EVENT_TYPES: RestEventType[] = ['opened', 'sealed', 'divided', 'note']

const EVENT_LABELS: Record<RestEventType, string> = {
  opened: '开袋',
  sealed: '密封',
  divided: '分装',
  note: '养豆备注'
}

const nowIso = () => new Date().toISOString()

export default function BeanRestPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const beanId = router.params.beanId as string
  const presetRoastBatchId = router.params.roastBatchId as string | undefined
  const queryClient = useQueryClient()

  const { data: bean } = useQuery({
    queryKey: ['bean', beanId], queryFn: () => api.getBean(beanId), enabled: !!beanId
  })
  const isGreen = bean?.kind === 'green'
  const { data: roasts } = useQuery({
    queryKey: ['beanRoasts', beanId], queryFn: () => api.beanRoasts(beanId), enabled: isGreen
  })
  const { data: eventsData } = useQuery({
    queryKey: ['restEvents', beanId],
    queryFn: () => api.listRestEvents(beanId),
    enabled: !!beanId
  })

  /** 生豆的事件挂在具体炉次上 */
  const beanRoasts = (roasts?.items ?? []).filter(r => r.completed)

  const [type, setType] = useState<RestEventType>('opened')
  const [roastBatchId, setRoastBatchId] = useState(presetRoastBatchId ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<RestEvent>()

  const events = (eventsData?.items ?? []).filter(
    event => !presetRoastBatchId || event.roastBatchId === presetRoastBatchId
  )
  const cancelEdit = () => {
    setEditing(undefined)
    setType('opened')
    setNote('')
    setRoastBatchId(presetRoastBatchId ?? '')
  }
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['restEvents', beanId] })

  const save = async () => {
    if (!bean?.kind || saving) return
    if (isGreen && !beanRoasts.some(roast => roast.id === roastBatchId)) {
      Taro.showToast({ title: '请选择烘焙炉次', icon: 'none' })
      return
    }
    setSaving(true)
    try {
      const data = {
        type,
        roastBatchId: isGreen ? roastBatchId : undefined,
        note: note.trim()
      }
      if (editing) await api.updateRestEvent(beanId, editing.id, data)
      else await api.createRestEvent(beanId, { ...data, occurredAt: nowIso() })
      cancelEdit()
      await refresh()
      Taro.showToast({ title: editing ? '已更新' : '已登记', icon: 'success' })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '登记失败'
      Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (eventId: string) => {
    const res = await Taro.showModal({
      title: '删除养豆事件',
      content: '删除后无法恢复',
      confirmColor: '#C0392B'
    })
    if (!res.confirm) return
    try {
      await api.deleteRestEvent(beanId, eventId)
      if (editing?.id === eventId) cancelEdit()
      await refresh()
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">REST EVENT</Text>
        <Text className="page__title">养豆事件</Text>
        <Text className="dim list-sub">
          {bean?.name ?? ''} · 共 {events.length} 条
        </Text>
      </View>

      <View className="page__body">
        {/* 事件类型 */}
        <View className="block">
          <Text className="section-title">事件类型</Text>
          <View className="chips">
            {EVENT_TYPES.map(t => (
              <View
                key={t}
                className={type === t ? 'tag tag--active' : 'tag'}
                onClick={() => setType(t)}
              >
                {EVENT_LABELS[t]}
              </View>
            ))}
          </View>
        </View>

        {/* 生豆：选炉次 */}
        {isGreen && (
          <View className="block">
            <Text className="section-title">烘焙炉次</Text>
            <View className="chips">
              {beanRoasts.filter(r => !presetRoastBatchId || r.id === presetRoastBatchId).map(r => (
                <View
                  key={r.id}
                  className={
                    roastBatchId === r.id ? 'tag tag--active' : 'tag'
                  }
                  onClick={() => setRoastBatchId(r.id)}
                >
                  {r.batchNo}{r.roastLevel && ` · ${ROAST_LEVEL_LABELS[r.roastLevel]}`}
                </View>
              ))}
            </View>
            {!beanRoasts.length && (
              <View className="empty empty--inline">
                这支生豆还没有烘焙批次，先烘焙后才能登记养豆事件
              </View>
            )}
          </View>
        )}

        {/* 备注 */}
        <View className="block">
          <Text className="section-title">备注</Text>
          <View className="form">
            <View className="form__row form__row--block">
              <Textarea
                className="form__textarea"
                value={note}
                placeholder="可选"
                onInput={e => setNote(e.detail.value)}
              />
            </View>
          </View>
        </View>

        <View className="actions">
          <View
            className={saving ? 'btn btn--primary btn--disabled' : 'btn btn--primary'}
            onClick={saving || !bean?.kind ? undefined : save}
          >
            {saving ? '保存中…' : editing ? '保存更正' : '登记事件'}
          </View>
          {editing && <View className="btn btn--ghost" onClick={cancelEdit}>取消更正</View>}
        </View>

        {/* 历史事件 */}
        {events.length ? (
          <View className="block">
            <Text className="section-title">已登记</Text>
            <View className="panel panel--flush">
              {events.map((e, i) => (
                <View
                  key={e.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">
                      {EVENT_LABELS[e.type] || e.type}
                    </Text>
                    <Text className="mute list-row__sub">
                      {new Date(e.occurredAt).toLocaleString()}
                      {e.roastBatchId && ` · ${beanRoasts.find(r => r.id === e.roastBatchId)?.batchNo ?? '炉次'}`}
                      {e.note ? ` · ${e.note}` : ''}
                    </Text>
                  </View>
                  <View className="list-row__side">
                    <Text className="list-row__meta" onClick={() => {
                      setEditing(e)
                      setType(e.type)
                      setNote(e.note ?? '')
                      setRoastBatchId(e.roastBatchId ?? '')
                    }}>更正</Text>
                    <Text className="list-row__meta" onClick={() => remove(e.id)}> 删除</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View className="empty">还没有养豆事件</View>
        )}
      </View>
    </View>
  )
}
