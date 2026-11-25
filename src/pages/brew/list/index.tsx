import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import { BREW_METHODS } from '../../../domain/methods'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'

export default function BrewListPage() {
  const { themeClass } = useResolvedTheme()
  const [filter, setFilter] = useState<string>('all')
  const { data: brews } = useQuery({ queryKey: ['brews'], queryFn: () => api.listBrews() })
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })

  const list = useMemo(() => {
    const items = brews?.items ?? []
    return filter === 'all' ? items : items.filter(b => b.method === filter)
  }, [brews, filter])

  const usedMethods = useMemo(() => {
    const ids = new Set((brews?.items ?? []).map(b => b.method))
    return BREW_METHODS.filter(m => ids.has(m.id))
  }, [brews])

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">BREW LOG</Text>
        <Text className="page__title">冲煮记录</Text>
        <Text className="dim list-sub">共 {list.length} 条记录</Text>
      </View>

      <View className="page__body">
        <ScrollView className="filters" scrollX>
          <View
            className={filter === 'all' ? 'filter-chip filter-chip--active' : 'filter-chip'}
            onClick={() => setFilter('all')}
          >
            全部
          </View>
          {usedMethods.map(m => (
            <View
              key={m.id}
              className={filter === m.id ? 'filter-chip filter-chip--active' : 'filter-chip'}
              onClick={() => setFilter(m.id)}
            >
              {m.name}
            </View>
          ))}
        </ScrollView>

        {list.length ? (
          <View className="panel panel--flush">
            {list.map((b, i) => {
              const method = BREW_METHODS.find(m => m.id === b.method)
              const bean = beans?.items.find(x => x.id === b.beanId)
              const pts = b.curve.points
              const dur = pts.length ? pts[pts.length - 1].t : 0
              const w = pts.length ? pts[pts.length - 1].w : 0
              return (
                <View
                  key={b.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                  onClick={() => Taro.navigateTo({ url: `/pages/brew/detail/index?id=${b.id}` })}
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">{bean?.name ?? '未知豆子'}</Text>
                    <Text className="mute list-row__sub">
                      {method?.name} · {b.params.doseGrams}g / {b.params.waterGrams}g
                    </Text>
                    <Text className="mute list-row__sub">
                      {b.params.brewSeconds}s · {b.params.temperature}℃ · 曲线 {dur}s / {w}g
                    </Text>
                  </View>
                  <View className="list-row__side">
                    <Text className="mono list-row__score">{b.flavor.overall}</Text>
                    <Text className="mute list-row__meta">
                      {new Date(b.brewDate).toLocaleDateString().slice(5)}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        ) : (
          <View className="empty">这个筛选下还没有记录</View>
        )}
      </View>
    </View>
  )
}
