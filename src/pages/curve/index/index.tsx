import { useMemo, useState } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { BREW_METHODS } from '../../../domain/methods'
import { curveStats } from '../../../domain/curve/generate'
import { roastCurveStats } from '../../../domain/curve/roast'
import { ROAST_EVENT_LABELS, ROAST_LEVEL_LABELS } from '../../../domain/types'
import CurveChart from '../../../components/chart/CurveChart'
import RoastCurveChart from '../../../components/chart/RoastCurveChart'
import { useResolvedTheme } from '../../../store/useTheme'

import './index.scss'

export default function CurvePage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const queryClient = useQueryClient()
  const beanId = router.params.beanId as string | undefined
  const roastId = router.params.roastId as string | undefined
  const [tab, setTab] = useState<'brew' | 'roast'>(roastId ? 'roast' : 'brew')
  const [selectedBrewId, setSelectedBrewId] = useState('')
  const [selectedRoastId, setSelectedRoastId] = useState(roastId ?? '')

  const { data: brews } = useQuery({
    queryKey: beanId ? ['beanBrews', beanId] : ['brews'],
    queryFn: () => beanId ? api.beanBrews(beanId) : api.listBrews()
  })
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: bean } = useQuery({
    queryKey: ['bean', beanId], queryFn: () => api.getBean(beanId as string), enabled: !!beanId
  })
  const { data: roasts } = useQuery({
    queryKey: beanId ? ['beanRoasts', beanId] : ['roasts'],
    queryFn: () => beanId ? api.beanRoasts(beanId) : api.listRoasts()
  })

  /** 曲线始终归属到具体豆子：从豆子详情进入时只看这一支豆 */
  const brewList = useMemo(
    () => (brews?.items ?? []).filter(b => !roastId || b.roastBatchId === selectedRoastId),
    [brews, roastId, selectedRoastId]
  )
  const roastList = useMemo(
    () => (roasts?.items ?? []).filter(r => !beanId || r.beanId === beanId),
    [roasts, beanId]
  )

  const selected = useMemo(
    () => brewList.find(b => b.id === selectedBrewId) ?? brewList[0],
    [brewList, selectedBrewId]
  )

  const selectedRoast = useMemo(
    () => roastList.find(r => r.id === selectedRoastId) ?? roastList[0],
    [roastList, selectedRoastId]
  )

  /** 对比曲线：同一支豆的上一杯 */
  const overlay = useMemo(() => {
    if (!selected) return undefined
    const sameBean = brewList.filter(b => b.beanId === selected.beanId)
    const idx = sameBean.findIndex(b => b.id === selected.id)
    const prev = idx > 0 ? sameBean[idx - 1] : undefined
    if (!prev) return undefined
    return { label: '上一杯', points: prev.curve.points, color: '#E9B44C' }
  }, [brewList, selected])

  /** 对比批次：上一炉 */
  const roastOverlay = useMemo(() => {
    if (!selectedRoast) return undefined
    const sameBean = roastList.filter(r => r.beanId === selectedRoast.beanId)
    const idx = sameBean.findIndex(r => r.id === selectedRoast.id)
    const prev = idx > 0 ? sameBean[idx - 1] : undefined
    if (!prev || !prev.curve?.points?.length) return undefined
    return { label: '上一炉', points: prev.curve.points, color: '#E9B44C' }
  }, [roastList, selectedRoast])

  const brewStats = selected ? curveStats(selected.curve) : null
  const roastStats = roastCurveStats(selectedRoast?.curve?.points ?? [])
  const removeRoast = async () => {
    if (!selectedRoast) return
    const { confirm } = await Taro.showModal({
      title: '删除烘焙批次',
      content: `删除「${selectedRoast.batchNo}」后，账面生豆将恢复 ${selectedRoast.completed ? selectedRoast.greenGrams : 0} 克。`,
      confirmText: '删除'
    })
    if (!confirm) return
    try {
      await api.deleteRoast(selectedRoast.id)
      setSelectedRoastId('')
      void queryClient.invalidateQueries({ queryKey: ['bean', beanId] })
      void queryClient.invalidateQueries({ queryKey: ['beanRoasts', beanId] })
      void queryClient.invalidateQueries({ queryKey: ['roasts'] })
      void queryClient.invalidateQueries({ queryKey: ['beans'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (error: unknown) {
      Taro.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
    }
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">CURVE ANALYSIS</Text>
        <Text className="page__title">{bean ? bean.name : '曲线'}</Text>
        {bean && (
          <Text className="dim list-sub">
            {bean.roaster} · {bean.origin.country}
          </Text>
        )}
      </View>

      <View className="page__body">
        {/* 分段切换 */}
        <View className="segmented">
          <View
            className={tab === 'brew' ? 'segmented__item segmented__item--active' : 'segmented__item'}
            onClick={() => setTab('brew')}
          >
            <Text className="segmented__label">{roastId ? '本炉冲煮' : '冲煮曲线'}</Text>
          </View>
          <View
            className={tab === 'roast' ? 'segmented__item segmented__item--active' : 'segmented__item'}
            onClick={() => setTab('roast')}
          >
            <Text className="segmented__label">烘焙曲线</Text>
          </View>
        </View>

        {tab === 'brew' ? (
          !selected ? (
            <View className="empty">还没有曲线数据，先记录一杯</View>
          ) : (
            <>
              <Text className="dim list-sub">
                {beans?.items.find(b => b.id === selected.beanId)?.name ?? '未知豆子'} ·{' '}
                {BREW_METHODS.find(m => m.id === selected.method)?.name}
              </Text>
              <ScrollView className="filters" scrollX>
                {brewList.map(b => (
                  <View
                    key={b.id}
                    className={
                      b.id === selected.id ? 'filter-chip filter-chip--active' : 'filter-chip'
                    }
                    onClick={() => setSelectedBrewId(b.id)}
                  >
                    {new Date(b.brewDate).toLocaleDateString().slice(5)}
                  </View>
                ))}
              </ScrollView>

              <View className="chart-box">
                <CurveChart
                  points={selected.curve.points}
                  stages={selected.curve.stages}
                  height={260}
                  showFlow
                  overlays={overlay ? [overlay] : []}
                />
              </View>

              <View className="stage-legend">
                {selected.curve.stages.map((s, i) => (
                  <View className="stage-legend__item" key={`${s.from}-${i}`}>
                    <View
                      className="stage-legend__dot"
                      style={{ background: ['#7FD1C1', '#5FA8A0', '#E9B44C', '#6C9BD1'][i % 4] }}
                    />
                    <Text className="mute">{s.label}</Text>
                  </View>
                ))}
                {overlay && (
                  <View className="stage-legend__item">
                    <View className="stage-legend__dot" style={{ background: '#E9B44C' }} />
                    <Text className="mute">{overlay.label}</Text>
                  </View>
                )}
              </View>

              <View className="block">
                <Text className="section-title">曲线统计</Text>
                <View className="panel">
                  {[
                    { label: '总时长', value: `${brewStats?.duration} s` },
                    { label: '最终重量', value: `${brewStats?.finalWeight} g` },
                    { label: '平均流速', value: `${brewStats?.avgFlow} g/s` },
                    { label: '峰值流速', value: `${brewStats?.peakFlow} g/s` },
                    { label: '采样点', value: selected.curve.points.length }
                  ].map(row => (
                    <View className="data-row" key={row.label}>
                      <Text className="data-row__label">{row.label}</Text>
                      <Text className="data-row__value">{row.value}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View className="actions">
                <View
                  className="btn btn--ghost"
                  onClick={() => Taro.navigateTo({ url: `/pages/brew/detail/index?id=${selected.id}` })}
                >
                  查看完整详情
                </View>
              </View>
            </>
          )
        ) : !selectedRoast ? (
          <View className="empty">还没有烘焙批次记录</View>
        ) : (
          <>
            <Text className="dim list-sub">
              {beans?.items.find(b => b.id === selectedRoast.beanId)?.name ?? '未知豆子'} ·{' '}
              {selectedRoast.batchNo} · {selectedRoast.roaster}
              {selectedRoast.roastLevel && ` · ${ROAST_LEVEL_LABELS[selectedRoast.roastLevel]}`}
            </Text>

            <ScrollView className="filters" scrollX>
              {roastList.map(r => (
                <View
                  key={r.id}
                  className={
                    r.id === selectedRoast.id ? 'filter-chip filter-chip--active' : 'filter-chip'
                  }
                  onClick={() => setSelectedRoastId(r.id)}
                >
                  {r.batchNo}{r.roastLevel && ` · ${ROAST_LEVEL_LABELS[r.roastLevel]}`}
                </View>
              ))}
            </ScrollView>

            {selectedRoast.completed && bean?.kind === 'green' && (
              <View className="actions">
                <View className="btn btn--ghost" onClick={() => Taro.navigateTo({
                  url: `/pages/brew/bean/index?beanId=${beanId}&roastBatchId=${selectedRoast.id}`
                })}>用这炉冲煮</View>
                <View className="btn btn--ghost" onClick={() => Taro.navigateTo({
                  url: `/pages/bean/rest/index?beanId=${beanId}&roastBatchId=${selectedRoast.id}`
                })}>养豆事件</View>
              </View>
            )}

            {bean?.kind === 'green' && (
              <View className="actions">
                <View className="btn btn--ghost" onClick={() => Taro.navigateTo({
                  url: `/pages/roast/edit/index?beanId=${beanId}&id=${selectedRoast.id}`
                })}>更正炉次</View>
                <View className="btn btn--ghost" onClick={removeRoast}>删除炉次</View>
              </View>
            )}

            <View className="chart-box">
              <RoastCurveChart
                points={selectedRoast.curve?.points ?? []}
                events={selectedRoast.events}
                height={280}
                overlays={roastOverlay ? [roastOverlay] : []}
              />
            </View>

            <View className="stage-legend">
              <View className="stage-legend__item">
                <View className="stage-legend__dot" style={{ background: '#7FD1C1' }} />
                <Text className="mute">豆温 BT</Text>
              </View>
              <View className="stage-legend__item">
                <View className="stage-legend__dot" style={{ background: '#E9B44C' }} />
                <Text className="mute">环境温 ET</Text>
              </View>
              <View className="stage-legend__item">
                <View className="stage-legend__dot" style={{ background: '#E0604E' }} />
                <Text className="mute">升温率 RoR</Text>
              </View>
              {roastOverlay && (
                <View className="stage-legend__item">
                  <View className="stage-legend__dot" style={{ background: '#E9B44C' }} />
                  <Text className="mute">{roastOverlay.label}</Text>
                </View>
              )}
            </View>

            <View className="block">
              <Text className="section-title">烘焙指标</Text>
              <View className="panel">
                {[
                  {
                    label: '投豆 / 出豆',
                    value: `${selectedRoast.greenGrams}g → ${selectedRoast.outGrams}g`
                  },
                  { label: '失重率', value: `${selectedRoast.weightLossPercent}%` },
                  {
                    label: '总时长',
                    value: `${Math.floor(selectedRoast.totalSeconds / 60)}:${String(
                      selectedRoast.totalSeconds % 60
                    ).padStart(2, '0')}`
                  },
                  { label: '发展比 DTR', value: `${selectedRoast.dtrPercent}%` },
                  { label: '峰值豆温', value: `${roastStats.maxBt}℃` },
                  { label: '峰值 RoR', value: `${roastStats.peakRor}℃/min` },
                  {
                    label: '阶段占比',
                    value: `脱水 ${selectedRoast.phaseRatio.drying}% · 梅纳 ${selectedRoast.phaseRatio.maillard}% · 发展 ${selectedRoast.phaseRatio.development}%`
                  }
                ].map(row => (
                  <View className="data-row" key={row.label}>
                    <Text className="data-row__label">{row.label}</Text>
                    <Text className="data-row__value">{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className="block">
              <Text className="section-title">事件标记</Text>
              <View className="panel panel--flush">
                {selectedRoast.events.map((e, i) => (
                  <View className={i > 0 ? 'list-row list-row--bordered' : 'list-row'} key={e.type}>
                    <Text className="list-row__title">{ROAST_EVENT_LABELS[e.type]}</Text>
                    <View className="list-row__side">
                      <Text className="mono list-row__meta">
                        {Math.floor(e.atSecond / 60)}:{String(e.atSecond % 60).padStart(2, '0')}
                      </Text>
                      <Text className="mono list-row__meta">{e.temperature}℃</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  )
}
