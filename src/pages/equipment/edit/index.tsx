import { useEffect, useState } from 'react'
import { View, Text, Input, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import type { Equipment } from '../../../domain/types'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

const TYPES: Equipment['type'][] = [
  'grinder',
  'dripper',
  'brewer',
  'espresso',
  'scale',
  'roaster',
  'other'
]

const TYPE_LABELS: Record<Equipment['type'], string> = {
  grinder: '磨豆机',
  dripper: '滤杯',
  brewer: '冲煮器具',
  espresso: '咖啡机',
  scale: '电子秤',
  roaster: '烘豆机',
  other: '其他'
}

export default function EquipmentEditPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const id = router.params.id

  const { data: list } = useQuery({ queryKey: ['equipment'], queryFn: api.listEquipment })

  const [type, setType] = useState<Equipment['type']>('grinder')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [notes, setNotes] = useState('')
  const [loaded, setLoaded] = useState(false)

  // 编辑态：回填已有器具
  useEffect(() => {
    if (!id || loaded) return
    const found = (list?.items ?? []).find(e => e.id === id)
    if (found) {
      setType(found.type)
      setName(found.name || '')
      setBrand(found.brand || '')
      setModel(found.model || '')
      setNotes(found.notes || '')
    }
    setLoaded(true)
  }, [id, list, loaded])

  const save = async () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    const payload: Partial<Equipment> = {
      type,
      name: name.trim(),
      brand: brand.trim() || undefined,
      model: model.trim() || undefined,
      notes: notes.trim() || undefined
    }
    try {
      if (id) await api.updateEquipment(id, payload)
      else await api.createEquipment(payload)
      Taro.showToast({ title: '已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch (e) {
      Taro.showToast({ title: '保存失败', icon: 'none' })
    }
  }

  const remove = async () => {
    if (!id) return
    const res = await Taro.showModal({
      title: '删除器具',
      content: '删除后不影响已记录的历史冲煮',
      confirmColor: '#C0392B'
    })
    if (!res.confirm) return
    await api.deleteEquipment(id)
    Taro.showToast({ title: '已删除', icon: 'success' })
    setTimeout(() => Taro.navigateBack(), 600)
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">{id ? 'EDIT EQUIPMENT' : 'NEW EQUIPMENT'}</Text>
        <Text className="page__title">{id ? '编辑器具' : '新增器具'}</Text>
      </View>

      <View className="page__body">
        <View className="block">
          <Text className="section-title">类型</Text>
          <View className="chips">
            {TYPES.map(t => (
              <View
                key={t}
                className={type === t ? 'tag tag--active' : 'tag'}
                onClick={() => setType(t)}
              >
                {TYPE_LABELS[t]}
              </View>
            ))}
          </View>
        </View>

        <View className="block">
          <Text className="section-title">信息</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">名称</Text>
              <Input
                className="form__input"
                value={name}
                placeholder={type === 'grinder' ? '如 EK43' : '器具名称'}
                onInput={e => setName(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">品牌</Text>
              <Input
                className="form__input"
                value={brand}
                placeholder="可选"
                onInput={e => setBrand(e.detail.value)}
              />
            </View>
            <View className="form__row">
              <Text className="form__label">型号</Text>
              <Input
                className="form__input"
                value={model}
                placeholder="可选"
                onInput={e => setModel(e.detail.value)}
              />
            </View>
            <View className="form__row form__row--block">
              <Text className="form__label">
                {type === 'grinder' ? '刻度基准' : '备注'}
              </Text>
              <Textarea
                className="form__textarea"
                value={notes}
                placeholder={
                  type === 'grinder' ? '如 #22 约 0.8mm，粗细以刻度计' : '可选'
                }
                onInput={e => setNotes(e.detail.value)}
              />
            </View>
          </View>
        </View>

        <View className="actions">
          <View className="btn btn--primary" onClick={save}>
            保存
          </View>
          {id && (
            <View className="btn btn--ghost btn--danger" onClick={remove}>
              删除器具
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
