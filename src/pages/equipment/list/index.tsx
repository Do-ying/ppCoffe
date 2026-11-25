import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import type { Equipment } from '../../../domain/types'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

export const EQUIPMENT_TYPE_LABELS: Record<Equipment['type'], string> = {
  grinder: '磨豆机',
  dripper: '滤杯',
  brewer: '冲煮器具',
  espresso: '咖啡机',
  scale: '电子秤',
  roaster: '烘豆机',
  other: '其他'
}

const TYPE_ORDER: Equipment['type'][] = [
  'grinder',
  'dripper',
  'brewer',
  'espresso',
  'scale',
  'roaster',
  'other'
]

export default function EquipmentListPage() {
  const { themeClass } = useResolvedTheme()
  const { data } = useQuery({ queryKey: ['equipment'], queryFn: api.listEquipment })

  const grouped = useMemo(() => {
    const map = new Map<Equipment['type'], Equipment[]>()
    ;(data?.items ?? []).forEach(e => {
      if (!map.has(e.type)) map.set(e.type, [])
      map.get(e.type)!.push(e)
    })
    return TYPE_ORDER.filter(t => map.has(t)).map(t => [t, map.get(t)!] as const)
  }, [data])

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">EQUIPMENT</Text>
        <Text className="page__title">器具</Text>
        <Text className="dim list-sub">
          共 {(data?.items ?? []).length} 件 · 磨豆机的刻度基准会用于研磨度记录
        </Text>
      </View>

      <View className="page__body">
        {grouped.map(([type, items]) => (
          <View className="block" key={type}>
            <Text className="eyebrow group-label">{EQUIPMENT_TYPE_LABELS[type]}</Text>
            <View className="panel panel--flush">
              {items.map((e, i) => (
                <View
                  key={e.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                  onClick={() => Taro.navigateTo({ url: `/pages/equipment/edit/index?id=${e.id}` })}
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">{e.name}</Text>
                    <Text className="mute list-row__sub">
                      {[e.brand, e.model].filter(Boolean).join(' · ') || EQUIPMENT_TYPE_LABELS[e.type]}
                    </Text>
                    {e.notes && <Text className="mute list-row__sub">备注：{e.notes}</Text>}
                  </View>
                  <Text className="mute list-row__meta">›</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        {!grouped.length && <View className="empty">还没有添加器具</View>}

        <View className="actions">
          <View
            className="btn btn--primary"
            onClick={() => Taro.navigateTo({ url: '/pages/equipment/edit/index' })}
          >
            新增器具
          </View>
        </View>
      </View>
    </View>
  )
}
