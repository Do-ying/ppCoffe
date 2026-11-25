import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { BREW_METHODS } from '../../../domain/methods'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

const PROCESS_LABEL: Record<string, string> = {
  washed: '水洗',
  natural: '日晒',
  honey: '蜜处理',
  anaerobic: '厌氧',
  other: '其他'
}

const ROAST_LABEL: Record<string, string> = {
  light: '浅焙',
  medium: '中焙',
  medium_dark: '中深焙',
  dark: '深焙'
}

const STAGE_LABEL: Record<string, string> = {
  resting: '养豆中',
  peak: '赏味期',
  fading: '风味衰减'
}

export default function BeanDetailPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const queryClient = useQueryClient()
  const beanId = router.params.id as string

  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: brews } = useQuery({ queryKey: ['brews'], queryFn: () => api.listBrews() })
  const { data: roasts } = useQuery({ queryKey: ['roasts'], queryFn: api.listRoasts })

  const bean = beans?.items.find(b => b.id === beanId)

  const beanBrews = useMemo(
    () => (brews?.items ?? []).filter(b => b.beanId === beanId),
    [brews, beanId]
  )
  const beanRoasts = useMemo(
    () => (roasts?.items ?? []).filter(r => r.beanId === beanId),
    [roasts, beanId]
  )

  /** 删除豆子：后端会级联删除其下的冲煮与烘焙记录，删除前必须说清影响。 */
  const remove = async () => {
    if (!bean) return
    const affected: string[] = []
    if (beanBrews.length) affected.push(`${beanBrews.length} 条冲煮记录`)
    if (beanRoasts.length) affected.push(`${beanRoasts.length} 个烘焙批次`)

    const res = await Taro.showModal({
      title: '删除豆子',
      content: affected.length
        ? `「${bean.name}」及其 ${affected.join('、')} 都会被删除，且无法恢复。`
        : `确定删除「${bean.name}」吗？删除后无法恢复。`,
      confirmColor: '#C0392B'
    })
    if (!res.confirm) return

    try {
      await api.deleteBean(bean.id)
      // 关联的冲煮 / 烘焙列表也会变化，一并失效缓存
      queryClient.invalidateQueries()
      Taro.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 600)
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' })
    }
  }

  if (!bean) {
    return (
      <View className={`page ${themeClass}`}>
        <View className="empty">没有找到这支豆子</View>
      </View>
    )
  }

  const days = Math.floor((Date.now() - new Date(bean.roastDate).getTime()) / 86400000)
  const stage = days < 7 ? 'resting' : days <= 21 ? 'peak' : 'fading'

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">BEAN</Text>
        <Text className="page__title">{bean.name}</Text>
        <Text className="dim list-sub">
          {bean.roaster} · {bean.origin.country}
          {bean.origin.region ? ` ${bean.origin.region}` : ''}
          {bean.origin.farm ? ` ${bean.origin.farm}` : ''}
        </Text>
      </View>

      <View className="page__body">
        {/* 档案 */}
        <View className="panel">
          <View className="data-row">
            <Text className="data-row__label">处理法 / 烘焙度</Text>
            <Text className="data-row__value">
              {PROCESS_LABEL[bean.process]} · {ROAST_LABEL[bean.roastLevel]}
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">烘焙日期</Text>
            <Text className="data-row__value">
              {bean.roastDate}（{days} 天）
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">养豆状态</Text>
            <Text
              className={stage === 'peak' ? 'data-row__value signal' : stage === 'resting' ? 'data-row__value warn' : 'data-row__value danger'}
            >
              {STAGE_LABEL[stage]}
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">剩余</Text>
            <Text className="data-row__value">{bean.remainingGrams} g</Text>
          </View>
          {bean.origin.altitudeMasl && (
            <View className="data-row">
              <Text className="data-row__label">海拔</Text>
              <Text className="data-row__value">{bean.origin.altitudeMasl} m</Text>
            </View>
          )}
          {bean.origin.variety && (
            <View className="data-row">
              <Text className="data-row__label">品种</Text>
              <Text className="data-row__value">{bean.origin.variety}</Text>
            </View>
          )}
          {bean.notes && (
            <View className="data-row">
              <Text className="data-row__label">备注</Text>
              <Text className="data-row__value">{bean.notes}</Text>
            </View>
          )}
        </View>

        {/* 曲线入口：默认没有，需手动添加记录后才有 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">曲线</Text>
            <Text
              className="mute"
              onClick={() => Taro.navigateTo({ url: `/pages/curve/index/index?beanId=${beanId}` })}
            >
              查看全部
            </Text>
          </View>
          <View className="panel">
            <View className="data-row">
              <Text className="data-row__label">冲煮曲线</Text>
              <Text className="data-row__value">{beanBrews.length} 条</Text>
            </View>
            <View className="data-row">
              <Text className="data-row__label">烘焙曲线</Text>
              <Text className="data-row__value">{beanRoasts.length} 条</Text>
            </View>
            {!beanBrews.length && !beanRoasts.length && (
              <Text className="param__hint mute">
                默认没有曲线。添加冲煮记录或烘焙批次后，这里会自动生成。
              </Text>
            )}
          </View>
        </View>

        {/* 冲煮记录 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">冲煮记录</Text>
            <Text
              className="mute"
              onClick={() => {
                Taro.navigateTo({ url: '/pages/brew/method/index' })
              }}
            >
              + 冲煮
            </Text>
          </View>
          {beanBrews.length ? (
            <View className="panel panel--flush">
              {beanBrews.map((b, i) => (
                <View
                  key={b.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                  onClick={() => Taro.navigateTo({ url: `/pages/brew/detail/index?id=${b.id}` })}
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">
                      {BREW_METHODS.find(m => m.id === b.method)?.name ?? b.method}
                    </Text>
                    <Text className="mute list-row__sub">
                      {b.params.doseGrams}g / {b.params.waterGrams}g · {b.params.brewSeconds}s · 1:
                      {b.params.ratio?.toFixed(1)}
                    </Text>
                  </View>
                  <View className="list-row__side">
                    <Text className="mono list-row__score">{b.flavor.overall}</Text>
                    <Text className="mute list-row__meta">
                      {new Date(b.brewDate).toLocaleDateString().slice(5)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty empty--inline">还没有冲煮记录</View>
          )}
        </View>

        {/* 烘焙批次 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">烘焙批次</Text>
            <Text
              className="mute"
              onClick={() =>
                Taro.navigateTo({ url: `/pages/roast/edit/index?beanId=${beanId}` })
              }
            >
              + 烘焙
            </Text>
          </View>
          {beanRoasts.length ? (
            <View className="panel panel--flush">
              {beanRoasts.map((r, i) => (
                <View
                  key={r.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                  onClick={() =>
                    Taro.navigateTo({ url: `/pages/curve/index/index?beanId=${beanId}&roastId=${r.id}` })
                  }
                >
                  <View className="list-row__main">
                    <Text className="list-row__title mono">{r.batchNo}</Text>
                    <Text className="mute list-row__sub">
                      {r.roaster} · 失重 {r.weightLossPercent}% · DTR {r.dtrPercent}%
                    </Text>
                  </View>
                  <View className="list-row__side">
                    <Text className="mono list-row__meta">
                      {Math.floor(r.totalSeconds / 60)}:
                      {String(r.totalSeconds % 60).padStart(2, '0')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty empty--inline">还没有烘焙批次</View>
          )}
        </View>

        <View className="actions">
          <View
            className="btn btn--ghost"
            onClick={() => Taro.navigateTo({ url: `/pages/bean/edit/index?id=${beanId}` })}
          >
            编辑豆子信息
          </View>
        </View>

        <View className="actions actions--danger">
          <View className="btn btn--danger" onClick={remove}>
            删除这支豆子
          </View>
        </View>
      </View>
    </View>
  )
}
