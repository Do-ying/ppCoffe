import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

/** 秒 → 分:秒 */
function toMMSS(total: number) {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function RoastListPage() {
  const { themeClass } = useResolvedTheme()
  const { data: roasts } = useQuery({ queryKey: ['roasts'], queryFn: api.listRoasts })
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })

  /** 按豆子筛选；'all' 表示全部 */
  const [beanFilter, setBeanFilter] = useState<string>('all')

  const usedBeanIds = useMemo(
    () => new Set((roasts?.items ?? []).map(r => r.beanId)),
    [roasts]
  )

  /** 有烘焙记录的豆子（用于筛选条） */
  const filterBeans = useMemo(
    () => (beans?.items ?? []).filter(b => usedBeanIds.has(b.id)),
    [beans, usedBeanIds]
  )

  const list = useMemo(() => {
    const items = roasts?.items ?? []
    return beanFilter === 'all' ? items : items.filter(r => r.beanId === beanFilter)
  }, [roasts, beanFilter])

  /** 按烘焙日期倒序：最近的批次在前 */
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) =>
        (b.roastDate ?? '').localeCompare(a.roastDate ?? '')
      ),
    [list]
  )

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">ROAST LOG</Text>
        <Text className="page__title">烘焙记录</Text>
        <Text className="dim list-sub">
          共 {sorted.length} 个批次 · 曲线按豆子归档
        </Text>
      </View>

      <View className="page__body">
        <ScrollView className="filters" scrollX>
          <View
            className={
              beanFilter === 'all' ? 'filter-chip filter-chip--active' : 'filter-chip'
            }
            onClick={() => setBeanFilter('all')}
          >
            全部
          </View>
          {filterBeans.map(b => (
            <View
              key={b.id}
              className={
                beanFilter === b.id ? 'filter-chip filter-chip--active' : 'filter-chip'
              }
              onClick={() => setBeanFilter(b.id)}
            >
              {b.name}
            </View>
          ))}
        </ScrollView>

        {sorted.length ? (
          <View className="panel panel--flush">
            {sorted.map((r, i) => {
              const bean = beans?.items.find(x => x.id === r.beanId)
              return (
                <View
                  key={r.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                  onClick={() =>
                    Taro.navigateTo({
                      url: `/pages/curve/index/index?beanId=${r.beanId}&roastId=${r.id}`
                    })
                  }
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">
                      {bean?.name ?? '未知豆子'}
                    </Text>
                    <Text className="mute list-row__sub">
                      批次 {r.batchNo} · {r.roaster}
                    </Text>
                    <Text className="mute list-row__sub">
                      失重 {r.weightLossPercent}% · DTR {r.dtrPercent}% ·{' '}
                      {toMMSS(r.totalSeconds)}
                    </Text>
                  </View>
                  <View className="list-row__side">
                    {r.cuppingScore ? (
                      <Text className="mono list-row__score">{r.cuppingScore}</Text>
                    ) : (
                      <Text className="mono list-row__meta">
                        {r.greenGrams}→{r.outGrams}g
                      </Text>
                    )}
                    <Text className="mute list-row__meta">
                      {new Date(r.roastDate).toLocaleDateString().slice(5)}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        ) : (
          <View className="empty">
            还没有烘焙批次{'\n'}在豆子详情页可以新建一个批次
          </View>
        )}

        <View className="actions">
          <View
            className="btn btn--primary"
            onClick={() => Taro.navigateTo({ url: '/pages/roast/edit/index' })}
          >
            添加烘焙批次
          </View>
        </View>
      </View>
    </View>
  )
}
