import { useEffect, useMemo, useState } from 'react'
import { View, Text, Input, Picker } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS } from '../../../domain/types'
import type { RoastBatchPayload, RoastEvent } from '../../../domain/types'
import { computeRoastMetrics, generateRoastCurve } from '../../../domain/curve/roast'
import { useResolvedTheme } from '../../../store/useTheme'
import BackBar from '../../../components/back-bar'

import './index.scss'

const pad = (value: number) => String(value).padStart(2, '0')

const ROASTS: NonNullable<RoastBatchPayload['roastLevel']>[] = [
  'light',
  'medium',
  'medium_dark',
  'dark'
]

/** 秒 → 分:秒 */
function toMMSS(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 分:秒 或 纯秒 → 秒 */
function parseTime(v: string): number {
  const t = v.trim()
  if (!t) return 0
  if (t.includes(':')) {
    const [m, s] = t.split(':')
    return Number(m || 0) * 60 + Number(s || 0)
  }
  return Number(t) || 0
}

export default function RoastEditPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const presetBeanId = router.params.beanId as string | undefined
  const roastId = router.params.id
  const queryClient = useQueryClient()

  const { data: existing, isError } = useQuery({
    queryKey: ['roast', roastId], queryFn: () => api.getRoast(roastId as string), enabled: !!roastId
  })
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: presetBean } = useQuery({
    queryKey: ['bean', presetBeanId],
    queryFn: () => api.getBean(presetBeanId as string),
    enabled: !!presetBeanId
  })
  const { data: equipmentList } = useQuery({
    queryKey: ['equipment'],
    queryFn: api.listEquipment
  })

  const [beanId, setBeanId] = useState(presetBeanId || '')
  const [openedAt] = useState(() => new Date())
  const [roastDay, setRoastDay] = useState(
    () => `${openedAt.getFullYear()}-${pad(openedAt.getMonth() + 1)}-${pad(openedAt.getDate())}`
  )
  const [roastTime, setRoastTime] = useState(
    () => `${pad(openedAt.getHours())}:${pad(openedAt.getMinutes())}`
  )
  const [batchNo, setBatchNo] = useState(() => `${roastDay.replace(/-/g, '')}-A`)
  const [submissionId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const [saving, setSaving] = useState(false)
  const [roaster, setRoaster] = useState('')
  const [greenGrams, setGreenGrams] = useState('500')
  const [outGrams, setOutGrams] = useState('425')
  const [totalTime, setTotalTime] = useState('8:32')
  const [chargeTemp, setChargeTemp] = useState('205')
  const [dryEndTime, setDryEndTime] = useState('4:00')
  const [dryEndTemp, setDryEndTemp] = useState('158')
  const [fcTime, setFcTime] = useState('5:48')
  const [fcTemp, setFcTemp] = useState('201')
  const [dropTemp, setDropTemp] = useState('216')
  /** 每炉的烘焙度（生豆分多炉时各炉独立） */
  const [roastLevel, setRoastLevel] = useState<
    NonNullable<RoastBatchPayload['roastLevel']>
  >('light')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!existing || loaded) return
    setBeanId(existing.beanId)
    setBatchNo(existing.batchNo)
    setRoaster(existing.roaster)
    setGreenGrams(String(existing.greenGrams))
    setOutGrams(String(existing.outGrams))
    if (existing.roastLevel) setRoastLevel(existing.roastLevel)
    setLoaded(true)
  }, [existing, loaded])

  /** 烘焙入口仅对生豆开放 —— 成品豆直接冲煮 */
  const greenBeans = (beans?.items ?? []).filter(b => b.kind === 'green')
  if (presetBean?.kind === 'green' && !greenBeans.some(b => b.id === presetBean.id)) {
    greenBeans.unshift(presetBean)
  }

  const roasters = useMemo(
    () => (equipmentList?.items ?? []).filter(e => e.type === 'roaster'),
    [equipmentList]
  )

  const save = async () => {
    if (saving) return
    const bean = greenBeans.find(item => item.id === beanId)
    if (!bean && !existing) {
      Taro.showToast({ title: '请选择生豆', icon: 'none' })
      return
    }
    const total = parseTime(totalTime)
    const timestamp = new Date(`${roastDay}T${roastTime}:00`)
    if (!batchNo.trim() || (!existing &&
      (!Number.isInteger(total) || total <= 0 || !Number.isFinite(timestamp.getTime())))) {
      Taro.showToast({ title: '请填写炉号、下豆时间和有效总时长', icon: 'none' })
      return
    }
    const events: RoastEvent[] = [
      { type: 'charge', atSecond: 0, temperature: Number(chargeTemp) || 200 },
      {
        type: 'dryEnd',
        atSecond: parseTime(dryEndTime),
        temperature: Number(dryEndTemp) || 155
      },
      { type: 'firstCrack', atSecond: parseTime(fcTime), temperature: Number(fcTemp) || 200 },
      { type: 'drop', atSecond: total, temperature: Number(dropTemp) || 215 }
    ]

    const green = Number(greenGrams) || 0
    const out = Number(outGrams) || 0
    if (!Number.isInteger(green) || green <= 0) {
      Taro.showToast({ title: '投豆克数须为正整数', icon: 'none' })
      return
    }
    if (!Number.isInteger(out) || out <= 0) {
      Taro.showToast({ title: '出豆克数须为正整数', icon: 'none' })
      return
    }
    if (out > green) {
      Taro.showToast({ title: '出豆克数不能大于投豆克数', icon: 'none' })
      return
    }

    const metrics = computeRoastMetrics({
      greenGrams: green,
      outGrams: out,
      totalSeconds: total,
      events
    })

    // 提交载荷：curve 在请求体里是**采样点数组**（不是读取时的对象形态），
    // 所以这里不能用 Partial<RoastBatch> —— 那是读取响应的类型。
    const payload: RoastBatchPayload = {
      beanId,
      batchNo: batchNo.trim(),
      submissionId,
      roaster: roaster.trim() || '未指定烘豆机',
      greenGrams: green,
      outGrams: out,
      totalSeconds: total,
      events,
      ...metrics,
      curve: generateRoastCurve(events, total),
      roastLevel,
      roastDate: timestamp.toISOString()
    }

    setSaving(true)
    try {
      if (existing) {
        await api.updateRoast(existing.id, {
          batchNo: payload.batchNo, roaster: payload.roaster,
          greenGrams: green, outGrams: out, roastLevel
        })
      } else {
        await api.createRoast(payload)
      }
      void queryClient.invalidateQueries({ queryKey: ['roast', roastId] })
      void queryClient.invalidateQueries({ queryKey: ['bean', beanId] })
      void queryClient.invalidateQueries({ queryKey: ['beanRoasts', beanId] })
      void queryClient.invalidateQueries({ queryKey: ['beans'] })
      void queryClient.invalidateQueries({ queryKey: ['roasts'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
      Taro.showToast({ title: '已保存', icon: 'success' })
      await Taro.navigateBack()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '保存失败'
      Taro.showToast({ title: message, icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  if (roastId && !loaded) {
    return (
      <View className={`page ${themeClass}`}>
        <BackBar fallback="/pages/roast/list/index" />
        <Text>{isError ? '读取炉次失败' : '加载中…'}</Text>
      </View>
    )
  }

  return (
    <View className={`page ${themeClass}`}>
      <BackBar fallback="/pages/roast/list/index" />
      <View className="page__header">
        <Text className="eyebrow">NEW ROAST</Text>
        <Text className="page__title">{existing ? '更正烘焙批次' : '添加烘焙批次'}</Text>
        {!existing && <Text className="dim list-sub">按事件打点保存，系统据此合成烘焙曲线</Text>}
      </View>

      <View className="page__body">
        {/* 豆子：烘焙入口仅对生豆开放 */}
        {!existing && <View className="block">
          <Text className="section-title">所属生豆</Text>
          <View className="chips">
            {greenBeans.map(b => (
              <View
                key={b.id}
                className={beanId === b.id ? 'tag tag--active' : 'tag'}
                onClick={() => setBeanId(b.id)}
              >
                {b.name}
              </View>
            ))}
          </View>
          {!greenBeans.length && (
            <View className="empty empty--inline">
              没有可烘焙的生豆{'\n'}成品豆可直接冲煮，不需要烘焙
            </View>
          )}
        </View>}

        {/* 每炉烘焙度 */}
        <View className="block">
          <Text className="section-title">本炉烘焙度</Text>
          <View className="chips">
            {ROASTS.map(r => (
              <View
                key={r}
                className={roastLevel === r ? 'tag tag--active' : 'tag'}
                onClick={() => setRoastLevel(r)}
              >
                {ROAST_LEVEL_LABELS[r]}
              </View>
            ))}
          </View>
          <Text className="param__hint mute">
            同一批生豆可分多炉，每炉的烘焙度独立保存
          </Text>
        </View>

        {/* 批次 */}
        <View className="block">
          <Text className="section-title">批次</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">批次号</Text>
              <Input
                className="form__input"
                value={batchNo}
                onInput={e => setBatchNo(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">烘豆机</Text>
              <Input
                className="form__input"
                value={roaster}
                placeholder={roasters[0]?.name || '如 Aillio Bullet R2'}
                onInput={e => setRoaster(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">投豆量</Text>
              <Input
                className="form__input"
                value={greenGrams}
                placeholder="克"
                onInput={e => setGreenGrams(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">出豆量</Text>
              <Input
                className="form__input"
                value={outGrams}
                placeholder="克"
                onInput={e => setOutGrams(e.detail.value)}
              />
            </View>
          </View>
        </View>

        {/* 事件打点 */}
        {!existing && <View className="block">
          <Text className="section-title">事件打点</Text>
          <Text className="param__hint mute">时间用「分:秒」或秒数都可以</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">下豆时间</Text>
              <Picker mode="date" value={roastDay} onChange={e => setRoastDay(String(e.detail.value))}>
                <Text>{roastDay}</Text>
              </Picker>
              <Picker mode="time" value={roastTime} onChange={e => setRoastTime(String(e.detail.value))}>
                <Text>{roastTime}</Text>
              </Picker>
            </View>
            <View className="form__row">
              <Text className="form__label">投豆温度</Text>
              <Input
                className="form__input"
                value={chargeTemp}
                placeholder="℃"
                onInput={e => setChargeTemp(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">脱水结束</Text>
              <Input
                className="form__input"
                value={`${dryEndTime} / ${dryEndTemp}℃`}
                placeholder="4:00 / 158℃"
                onInput={e => {
                  const [t, tp] = e.detail.value.split('/')
                  setDryEndTime((t || '').trim())
                  setDryEndTemp(((tp || '').replace(/[^\d.]/g, '') || '').trim())
                }}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">一爆</Text>
              <Input
                className="form__input"
                value={`${fcTime} / ${fcTemp}℃`}
                placeholder="5:48 / 201℃"
                onInput={e => {
                  const [t, tp] = e.detail.value.split('/')
                  setFcTime((t || '').trim())
                  setFcTemp(((tp || '').replace(/[^\d.]/g, '') || '').trim())
                }}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">下豆温度</Text>
              <Input
                className="form__input"
                value={dropTemp}
                placeholder="℃"
                onInput={e => setDropTemp(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">总时长</Text>
              <Input
                className="form__input"
                value={totalTime}
                placeholder="8:32"
                onInput={e => setTotalTime(e.detail.value)}
              />
            </View>
          </View>
          <Text className="param__hint mute">
            预计总时长 {toMMSS(parseTime(totalTime))} · 回温点由曲线最低点自动推算
          </Text>
        </View>}

        <View className="actions">
          <View className="btn btn--primary" onClick={saving ? undefined : save}>
            {saving ? '保存中…' : '保存批次'}
          </View>
        </View>
      </View>
    </View>
  )
}
