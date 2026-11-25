import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../services'
import { BREW_METHODS } from '../../domain/methods'

import './index.scss'
import { useResolvedTheme } from '../../store/useTheme'

const RESTING_LABEL: Record<string, string> = {
  resting: '养豆中',
  peak: '赏味期',
  fading: '风味衰减'
}

export default function HomePage() {
  const { themeClass } = useResolvedTheme()
  const { data: summary } = useQuery({ queryKey: ['summary'], queryFn: api.statsSummary })
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: brews } = useQuery({ queryKey: ['brews'], queryFn: () => api.listBrews() })

  const quickMethods = useMemo(() => BREW_METHODS.slice(0, 8), [])

  const go = (url: string) => Taro.navigateTo({ url })

  const recent = (brews?.items ?? []).slice(0, 5)

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <View className="home-top">
          <View>
            <Text className="eyebrow">BREW &amp; ROAST LAB</Text>
            <Text className="page__title">ppCoffe</Text>
          </View>
          <Text className="home-settings" onClick={() => go('/pages/settings/index')}>
            设置
          </Text>
        </View>
        <Text className="dim home-sub">把风味做成可比较的数据</Text>
      </View>

      <View className="page__body">
        {/* 统计 */}
        <View className="stat-row">
          <View className="stat">
            <Text className="eyebrow">本周冲煮</Text>
            <Text className="stat__value mono">{summary?.week.brewCount ?? 0}</Text>
            <Text className="stat__unit">杯</Text>
          </View>
          <View className="stat">
            <Text className="eyebrow">平均风味</Text>
            <Text className="stat__value mono">{summary?.week.avgFlavor ?? 0}</Text>
            <Text className="stat__unit">/ 10</Text>
          </View>
          <View className="stat">
            <Text className="eyebrow">豆仓</Text>
            <Text className="stat__value mono">{beans?.items.length ?? 0}</Text>
            <Text className="stat__unit">支</Text>
          </View>
        </View>

        {/* 快速记录 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">快速记录</Text>
            <Text className="mute" onClick={() => go('/pages/brew/method/index')}>
              全部方式
            </Text>
          </View>
          <View className="quick-grid">
            {quickMethods.map(m => (
              <View
                key={m.id}
                className="quick-item"
                onClick={() => go(`/pages/brew/method/index?method=${m.id}`)}
              >
                <Text className="quick-item__name">{m.name.split(' · ')[0]}</Text>
                <Text className="quick-item__hint mono">
                  {m.params.ratio?.target ? `1:${m.params.ratio.target}` : m.grindHint.slice(0, 4)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 工具入口 */}
        <View className="block">
          <Text className="section-title">工具</Text>
          <View className="tool-row">
            <View
              className="tool-item"
              onClick={() => go('/pages/equipment/list/index')}
            >
              <Text className="tool-item__name">器具</Text>
              <Text className="tool-item__hint">磨豆机 · 滤杯 · 咖啡机</Text>
            </View>
            <View
              className="tool-item"
              onClick={() => Taro.switchTab({ url: '/pages/bean/list/index' })}
            >
              <Text className="tool-item__name">豆仓</Text>
              <Text className="tool-item__hint">曲线按豆子归档</Text>
            </View>
            <View
              className="tool-item"
              onClick={() => go('/pages/roast/list/index')}
            >
              <Text className="tool-item__name">烘焙</Text>
              <Text className="tool-item__hint">批次 · 失重 · DTR</Text>
            </View>
          </View>
        </View>

        {/* 养豆提醒 */}
        {!!summary?.restingBeans?.length && (
          <View className="block">
            <Text className="section-title">养豆状态</Text>
            <View className="panel panel--flush">
              {summary.restingBeans.map((b, i) => (
                <View key={b.beanId} className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}>                  <View className="list-row__main">
                    <Text className="list-row__title">{b.name}</Text>
                    <Text className="mute list-row__sub">烘焙 {b.roastDate}</Text>
                  </View>
                  <View className="list-row__side">
                    <Text className="mono list-row__meta">{b.daysSinceRoast} 天</Text>
                    <Text
                      className={
                        b.stage === 'peak' ? 'signal' : b.stage === 'resting' ? 'warn' : 'danger'
                      }
                    >
                      {RESTING_LABEL[b.stage]}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 最近记录 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">最近记录</Text>
            <Text className="mute" onClick={() => Taro.switchTab({ url: '/pages/brew/list/index' })}>
              全部
            </Text>
          </View>
          {recent.length ? (
            <View className="panel panel--flush">
              {recent.map((b, i) => {
                const method = BREW_METHODS.find(m => m.id === b.method)
                const bean = beans?.items.find(x => x.id === b.beanId)
                return (
                  <View
                    key={b.id}
                    className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                    onClick={() => go(`/pages/brew/detail/index?id=${b.id}`)}
                  >
                    <View className="list-row__main">
                      <Text className="list-row__title">{bean?.name ?? '未知豆子'}</Text>
                      <Text className="mute list-row__sub">
                        {method?.name} · {b.params.doseGrams}g / {b.params.waterGrams}g ·{' '}
                        {b.params.brewSeconds}s
                      </Text>
                    </View>
                    <View className="list-row__side">
                      <Text className="mono list-row__score">{b.flavor.overall}</Text>
                      <Text className="mute list-row__meta">
                        1:{b.params.ratio?.toFixed(1)}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          ) : (
            <View className="empty">还没有冲煮记录，去「快速记录」开始第一杯</View>
          )}
        </View>
      </View>
    </View>
  )
}
