import { useMemo, useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import type { RoastBatch, RoastEvent } from '../../../domain/types'
import { computeRoastMetrics, generateRoastCurve } from '../../../domain/curve/roast'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

const today = () => new Date().toISOString().slice(0, 10)

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

  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: equipmentList } = useQuery({
    queryKey: ['equipment'],
    queryFn: api.listEquipment
  })

  const [beanId, setBeanId] = useState(presetBeanId || '')
  const [batchNo, setBatchNo] = useState(
    `${today().replace(/-/g, '')}-A`
  )
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

  const roasters = useMemo(
    () => (equipmentList?.items ?? []).filter(e => e.type === 'roaster'),
    [equipmentList]
  )

  const save = async () => {
    if (!beanId) {
      Taro.showToast({ title: '请选择豆子', icon: 'none' })
      return
    }
    const total = parseTime(totalTime)
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

    const metrics = computeRoastMetrics({
      greenGrams: Number(greenGrams) || 0,
      outGrams: Number(outGrams) || 0,
      totalSeconds: total,
      events
    })

    const payload: Partial<RoastBatch> = {
      beanId,
      batchNo: batchNo.trim(),
      roaster: roaster.trim() || '未指定烘豆机',
      greenGrams: Number(greenGrams) || 0,
      outGrams: Number(outGrams) || 0,
      totalSeconds: total,
      events,
      ...metrics,
      curve: generateRoastCurve(events, total),
      roastDate: new Date().toISOString()
    }

    try {
      await api.createRoast(payload)
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">NEW ROAST</Text>
        <Text className="page__title">添加烘焙批次</Text>
        <Text className="dim list-sub">按事件打点保存，系统据此合成烘焙曲线</Text>
      </View>

      <View className="page__body">
        {/* 豆子 */}
        <View className="block">
          <Text className="section-title">所属豆子</Text>
          <View className="chips">
            {(beans?.items ?? []).map(b => (
              <View
                key={b.id}
                className={beanId === b.id ? 'tag tag--active' : 'tag'}
                onClick={() => setBeanId(b.id)}
              >
                {b.name}
              </View>
            ))}
          </View>
          {!beans?.items.length && <View className="empty empty--inline">豆仓还没有豆子</View>}
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
        <View className="block">
          <Text className="section-title">事件打点</Text>
          <Text className="param__hint mute">时间用「分:秒」或秒数都可以</Text>
          <View className="form">
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
        </View>

        <View className="actions">
          <View className="btn btn--primary" onClick={save}>
            保存批次
          </View>
        </View>
      </View>
    </View>
  )
}
