import { useEffect, useState } from 'react'
import { View, Text, Input, Textarea, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS } from '../../../domain/types'
import type { Bean, BeanKind } from '../../../domain/types'
import { useResolvedTheme } from '../../../store/useTheme'
import { pickImages, type PickedImage } from '../../../platform/image'
import { uploadBeanCover } from '../../../services/uploads'

import './index.scss'

const PROCESSES: Bean['process'][] = ['washed', 'natural', 'honey', 'anaerobic', 'other']
const ROASTS = ['light', 'medium', 'medium_dark', 'dark'] as const

const PROCESS_LABELS: Record<Bean['process'], string> = {
  washed: '水洗',
  natural: '日晒',
  honey: '蜜处理',
  anaerobic: '厌氧',
  other: '其他'
}

const KINDS: BeanKind[] = ['purchased_roasted', 'green']

const KIND_LABELS: Record<BeanKind, string> = {
  purchased_roasted: '成品豆',
  green: '生豆'
}

const KIND_HINTS: Record<BeanKind, string> = {
  purchased_roasted: '购入即可冲煮 · 烘焙度与烘焙日期填在豆子这一层',
  green: '按购入批次登记库存 · 可分多炉烘焙，每炉单独记录烘焙度与曲线'
}

export default function BeanEditPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const id = router.params.id

  const queryClient = useQueryClient()
  const { data: existing, isError } = useQuery({
    queryKey: ['bean', id],
    queryFn: () => api.getBean(id as string),
    enabled: !!id
  })

  const [name, setName] = useState('')
  const [roaster, setRoaster] = useState('')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [farm, setFarm] = useState('')
  const [altitude, setAltitude] = useState('')
  const [variety, setVariety] = useState('')
  const [process, setProcess] = useState<Bean['process']>('washed')
  const [roastLevel, setRoastLevel] = useState<Bean['roastLevel']>('light')
  const [roastDate, setRoastDate] = useState('')
  const [weight, setWeight] = useState('200')
  const [remaining, setRemaining] = useState<string | undefined>()
  const [notes, setNotes] = useState('')
  /** 豆子类型：成品豆 / 生豆；旧数据为 undefined（待确认） */
  const [kind, setKind] = useState<BeanKind | undefined>(undefined)
  /** 实付豆款（元）—— 展示用，保存时转成分 */
  const [purchaseCost, setPurchaseCost] = useState('')
  /** 封面图：保存前先上传，拿到对象键后再随表单提交 */
  const [pickedCover, setPickedCover] = useState<PickedImage>()
  const [uploadedCover, setUploadedCover] = useState<{ objectKey: string; url: string }>()
  const [removeExistingCover, setRemoveExistingCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const coverUrl = pickedCover?.path ?? (removeExistingCover ? null : existing?.imageUrl)

  useEffect(() => {
    if (!existing || loaded) return
    const found = existing
      setName(found.name || '')
      setRoaster(found.roaster || '')
      setCountry(found.origin.country || '')
      setRegion(found.origin.region || '')
      setFarm(found.origin.farm || '')
      setAltitude(found.origin.altitudeMasl ? String(found.origin.altitudeMasl) : '')
      setVariety(found.origin.variety || '')
      setProcess(found.process)
      setRoastLevel(found.roastLevel ?? 'light')
      setRoastDate(found.roastDate ?? '')
      setWeight(String(found.weightGrams))
      setRemaining(String(found.remainingGrams ?? found.weightGrams))
      setNotes(found.notes || '')
      setKind(found.kind ?? undefined)
      setPurchaseCost(found.purchaseCostCents == null ? '' : String(found.purchaseCostCents / 100))
    setLoaded(true)
  }, [existing, loaded])

  const pickCover = async () => {
    try {
      const [picked] = await pickImages(1)
      if (picked) {
        setPickedCover(picked)
        setUploadedCover(undefined)
      }
    } catch {
      // 用户可以取消选图。
    }
  }

  const removeCover = () => {
    setPickedCover(undefined)
    setUploadedCover(undefined)
    setRemoveExistingCover(true)
  }

  const save = async () => {
    if (saving) return
    if (!name.trim()) {
      Taro.showToast({ title: '请填写豆子名称', icon: 'none' })
      return
    }
    if (!kind) {
      Taro.showToast({ title: '请选择豆子类型', icon: 'none' })
      return
    }
    const grams = Number(weight)
    const remainingGrams = Number(remaining ?? weight)
    if (!Number.isInteger(grams) || grams <= 0) {
      Taro.showToast({ title: '购入克数须为正整数', icon: 'none' })
      return
    }
    if (kind === 'purchased_roasted' &&
      (!Number.isInteger(remainingGrams) || remainingGrams < 0 || remainingGrams > grams)) {
      Taro.showToast({ title: '剩余克数须在 0 和购入克数之间', icon: 'none' })
      return
    }
    const costText = purchaseCost.trim()
    if (costText && !/^\d+(\.\d{1,2})?$/.test(costText)) {
      Taro.showToast({ title: '请填写有效豆款，最多两位小数', icon: 'none' })
      return
    }
    const costCents = costText ? Math.round(Number(costText) * 100) : null

    const payload: Partial<Bean> = {
      name: name.trim(),
      kind,
      roaster: roaster.trim(),
      origin: {
        country: country.trim(),
        region: region.trim() || undefined,
        farm: farm.trim() || undefined,
        altitudeMasl: altitude ? Number(altitude) : undefined,
        variety: variety.trim() || undefined
      },
      process,
      // 生豆的烘焙度与烘焙日期按炉填写，这一层留空
      roastLevel: kind === 'green' ? undefined : roastLevel,
      roastDate: kind === 'green' ? null : roastDate || null,
      weightGrams: grams,
      remainingGrams: kind === 'green' ? undefined : remainingGrams,
      purchaseCostCents: costCents,
      notes: notes.trim()
    }
    setSaving(true)
    try {
      if (pickedCover) {
        const uploaded = uploadedCover ?? await uploadBeanCover(pickedCover.path, pickedCover.size)
        setUploadedCover(uploaded)
        payload.sourceFileKey = uploaded.objectKey
      } else if (removeExistingCover) {
        payload.sourceFileKey = null
        payload.imageUrl = null
      }
      if (id) await api.updateBean(id, payload)
      else await api.createBean(payload)
      void queryClient.invalidateQueries({ queryKey: ['beans'] })
      void queryClient.invalidateQueries({ queryKey: ['bean', id] })
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

  if (id && !loaded) {
    return <View className={`page ${themeClass}`}><Text>{isError ? '读取豆子失败' : '加载中…'}</Text></View>
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">{id ? 'EDIT BEAN' : 'NEW BEAN'}</Text>
        <Text className="page__title">{id ? '编辑豆子' : '添加豆子'}</Text>
      </View>

      <View className="page__body">
        {/* 豆子类型：先选类型，再显示对应字段 */}
        <View className="block">
          <Text className="section-title">豆子类型</Text>
          <View className="chips">
            {KINDS.map(k => (
              <View
                key={k}
                className={kind === k ? 'tag tag--active' : 'tag'}
                onClick={() => setKind(k)}
              >
                {KIND_LABELS[k]}
              </View>
            ))}
          </View>
          {kind && <Text className="param__hint mute">{KIND_HINTS[kind]}</Text>}
          {id && !kind && (
            <Text className="param__hint warn">
              这支豆子还没有确认类型，确认后才能记录冲煮与烘焙
            </Text>
          )}
        </View>

        <View className="block">
          <Text className="section-title">购入信息</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">购入克数</Text>
              <Input
                className="form__input"
                value={weight}
                placeholder="克"
                onInput={e => setWeight(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">实付豆款</Text>
              <Input
                className="form__input"
                value={purchaseCost}
                placeholder="元，可留空"
                onInput={e => setPurchaseCost(e.detail.value)}
              />
            </View>
            {kind === 'purchased_roasted' && (
              <View className="form__row">
                <Text className="form__label">剩余克数</Text>
                <Input
                  className="form__input"
                  value={remaining ?? weight}
                  onInput={e => setRemaining(e.detail.value)}
                />
              </View>
            )}
          </View>
          {kind === 'green' && (
            <Text className="param__hint mute">
              生豆按购入批次登记库存，每炉烘焙会扣减剩余量
            </Text>
          )}
        </View>

        {/* 封面图：选填一张 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">封面图片</Text>
            {coverUrl && (
              <Text className="mute" onClick={saving ? undefined : removeCover}>
                移除
              </Text>
            )}
          </View>
          {coverUrl ? (
            <View className="cover">
              <Image className="cover__img" src={coverUrl} mode="aspectFill" />
              <View
                className="btn btn--ghost cover__btn"
                onClick={saving ? undefined : pickCover}
              >
                更换图片
              </View>
            </View>
          ) : (
            <View
              className="cover cover--empty"
              onClick={saving ? undefined : pickCover}
            >
              <Text className="cover__hint">
                选择一张图片（可选）
              </Text>
            </View>
          )}
        </View>

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
          <Text className="section-title">
            {kind === 'green' ? '处理法' : '处理法 / 烘焙度'}
          </Text>
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
          {kind !== 'green' && (
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
          )}
          {kind === 'green' && (
            <Text className="param__hint mute">
              生豆的烘焙度在每一炉烘焙时单独填写
            </Text>
          )}
        </View>

        <View className="block">
          <Text className="section-title">烘焙信息</Text>
          <View className="form">
            {kind !== 'green' && (
              <View className="form__row">
                <Text className="form__label">烘焙日期</Text>
                <Input
                  className="form__input"
                  value={roastDate}
                  placeholder="YYYY-MM-DD，可留空"
                  onInput={e => setRoastDate(e.detail.value)}
                />
              </View>
            )}
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
            {kind === 'green'
              ? '生豆的烘焙曲线记录在具体的烘焙批次上'
              : '烘焙日期决定养豆期提示，留空则显示「烘焙日期未知」'}
          </Text>
        </View>

        <View className="actions">
          <View className="btn btn--primary" onClick={saving ? undefined : save}>
            {saving ? '保存中…' : '保存'}
          </View>
        </View>
      </View>
    </View>
  )
}
