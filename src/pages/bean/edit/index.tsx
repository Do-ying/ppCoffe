import { useEffect, useState } from 'react'
import { View, Text, Input, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import type { Bean } from '../../../domain/types'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

const PROCESSES: Bean['process'][] = ['washed', 'natural', 'honey', 'anaerobic', 'other']
const ROASTS: Bean['roastLevel'][] = ['light', 'medium', 'medium_dark', 'dark']

const PROCESS_LABELS: Record<Bean['process'], string> = {
  washed: '水洗',
  natural: '日晒',
  honey: '蜜处理',
  anaerobic: '厌氧',
  other: '其他'
}

const ROAST_LABELS: Record<Bean['roastLevel'], string> = {
  light: '浅焙',
  medium: '中焙',
  medium_dark: '中深焙',
  dark: '深焙'
}

const today = () => new Date().toISOString().slice(0, 10)

export default function BeanEditPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const id = router.params.id

  const { data: list } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })

  const [name, setName] = useState('')
  const [roaster, setRoaster] = useState('')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [farm, setFarm] = useState('')
  const [altitude, setAltitude] = useState('')
  const [variety, setVariety] = useState('')
  const [process, setProcess] = useState<Bean['process']>('washed')
  const [roastLevel, setRoastLevel] = useState<Bean['roastLevel']>('light')
  const [roastDate, setRoastDate] = useState(today())
  const [weight, setWeight] = useState('200')
  const [notes, setNotes] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!id || loaded) return
    const found = (list?.items ?? []).find(b => b.id === id)
    if (found) {
      setName(found.name || '')
      setRoaster(found.roaster || '')
      setCountry(found.origin.country || '')
      setRegion(found.origin.region || '')
      setFarm(found.origin.farm || '')
      setAltitude(found.origin.altitudeMasl ? String(found.origin.altitudeMasl) : '')
      setVariety(found.origin.variety || '')
      setProcess(found.process)
      setRoastLevel(found.roastLevel)
      setRoastDate(found.roastDate || today())
      setWeight(String(found.weightGrams || 200))
      setNotes(found.notes || '')
    }
    setLoaded(true)
  }, [id, list, loaded])

  const save = async () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请填写豆子名称', icon: 'none' })
      return
    }
    const payload: Partial<Bean> = {
      name: name.trim(),
      roaster: roaster.trim(),
      origin: {
        country: country.trim(),
        region: region.trim() || undefined,
        farm: farm.trim() || undefined,
        altitudeMasl: altitude ? Number(altitude) : undefined,
        variety: variety.trim() || undefined
      },
      process,
      roastLevel,
      roastDate,
      weightGrams: Number(weight) || 200,
      remainingGrams: Number(weight) || 200,
      notes: notes.trim()
    }
    try {
      if (id) await api.updateBean(id, payload)
      else await api.createBean(payload)
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">{id ? 'EDIT BEAN' : 'NEW BEAN'}</Text>
        <Text className="page__title">{id ? '编辑豆子' : '添加豆子'}</Text>
      </View>

      <View className="page__body">
        <View className="block">
          <Text className="section-title">基本信息</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">名称</Text>
              <Input
                className="form__input"
                value={name}
                placeholder="如 耶加雪菲 · 科契尔 水洗 G1"
                onInput={e => setName(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">烘焙商</Text>
              <Input
                className="form__input"
                value={roaster}
                placeholder="可选"
                onInput={e => setRoaster(e.detail.value)}
              />
            </View>
          </View>
        </View>

        <View className="block">
          <Text className="section-title">产地</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">国家</Text>
              <Input
                className="form__input"
                value={country}
                placeholder="如 埃塞俄比亚"
                onInput={e => setCountry(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">产区</Text>
              <Input
                className="form__input"
                value={region}
                placeholder="如 Sidama"
                onInput={e => setRegion(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">庄园</Text>
              <Input
                className="form__input"
                value={farm}
                placeholder="如 Kochere"
                onInput={e => setFarm(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">海拔</Text>
              <Input
                className="form__input"
                value={altitude}
                placeholder="如 1950（米）"
                onInput={e => setAltitude(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">品种</Text>
              <Input
                className="form__input"
                value={variety}
                placeholder="如 74158"
                onInput={e => setVariety(e.detail.value)}
              />
            </View>
          </View>
        </View>

        <View className="block">
          <Text className="section-title">处理法 / 烘焙度</Text>
          <View className="chips">
            {PROCESSES.map(p => (
              <View
                key={p}
                className={process === p ? 'tag tag--active' : 'tag'}
                onClick={() => setProcess(p)}
              >
                {PROCESS_LABELS[p]}
              </View>
            ))}
          </View>
          <View className="chips">
            {ROASTS.map(r => (
              <View
                key={r}
                className={roastLevel === r ? 'tag tag--active' : 'tag'}
                onClick={() => setRoastLevel(r)}
              >
                {ROAST_LABELS[r]}
              </View>
            ))}
          </View>
        </View>

        <View className="block">
          <Text className="section-title">烘焙信息</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">烘焙日期</Text>
              <Input
                className="form__input"
                value={roastDate}
                placeholder="YYYY-MM-DD"
                onInput={e => setRoastDate(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">重量</Text>
              <Input
                className="form__input"
                value={weight}
                placeholder="克"
                onInput={e => setWeight(e.detail.value)}
              />
            </View>
            <View className="form__row form__row--block">
              <Text className="form__label">备注</Text>
              <Textarea
                className="form__textarea"
                value={notes}
                placeholder="可选"
                onInput={e => setNotes(e.detail.value)}
              />
            </View>
          </View>
          <Text className="param__hint mute">
            烘焙日期决定养豆期提示，烘焙曲线会记录在具体的烘焙批次上
          </Text>
        </View>

        <View className="actions">
          <View className="btn btn--primary" onClick={save}>
            保存
          </View>
        </View>
      </View>
    </View>
  )
}
