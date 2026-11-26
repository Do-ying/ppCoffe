import { useMemo, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS } from '../../../domain/types'
import { useBrewDraft } from '../../../store/useBrewDraft'
import { useResolvedTheme } from '../../../store/useTheme'
import BackBar from '../../../components/back-bar'

import './index.scss'

/**
 * 冲煮第一步：选豆子（生豆还需选炉次）。
 *
 * 入口：
 *   - 首页「快速记录」→ 先选豆，再选方式
 *   - 豆子详情「+ 冲煮」→ 带入 beanId（若为生豆仍需选炉次）
 *   - 炉次详情 → 带入 beanId + roastBatchId
 */
export default function BrewBeanPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const presetBeanId = router.params.beanId as string | undefined
  const presetRoastBatchId = router.params.roastBatchId as string | undefined
  const presetMethod = router.params.method

  const setBeanId = useBrewDraft(s => s.setBeanId)
  const setRoastBatchId = useBrewDraft(s => s.setRoastBatchId)

  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })

  /** 当前选中的豆子 */
  const [selectedBeanId, setSelectedBeanId] = useState<string>(presetBeanId || '')
  /** 生豆选中的炉次 */
  const [selectedRoastId, setSelectedRoastId] = useState<string>(
    presetRoastBatchId || ''
  )
  const { data: presetBean } = useQuery({
    queryKey: ['bean', presetBeanId],
    queryFn: () => api.getBean(presetBeanId as string),
    enabled: !!presetBeanId
  })
  const list = (beans?.items ?? []).some(b => b.id === presetBeanId) || !presetBean
    ? beans?.items ?? [] : [presetBean, ...(beans?.items ?? [])]

  const bean = list.find(b => b.id === selectedBeanId)
  const isGreen = bean?.kind === 'green'
  const { data: roasts } = useQuery({
    queryKey: ['beanRoasts', selectedBeanId],
    queryFn: () => api.beanRoasts(selectedBeanId),
    enabled: isGreen
  })

  const beanRoasts = useMemo(
    () =>
      (roasts?.items ?? []).filter(
        r => r.completed === true
      ),
    [roasts]
  )

  const pickBean = (id: string) => {
    setSelectedBeanId(id)
    // 换豆子后原炉次不再适用
    setSelectedRoastId('')
  }

  const next = () => {
    if (!bean) {
      Taro.showToast({ title: '请选择豆子', icon: 'none' })
      return
    }
    if (!bean.kind) {
      Taro.showToast({ title: '请到豆仓确认豆子类型', icon: 'none' })
      return
    }
    if (isGreen && !beanRoasts.some(roast => roast.id === selectedRoastId)) {
      Taro.showToast({ title: '生豆需选择烘焙炉次', icon: 'none' })
      return
    }
    setBeanId(bean.id)
    setRoastBatchId(isGreen ? selectedRoastId : undefined)
    Taro.navigateTo({ url: `/pages/brew/method/index${presetMethod ? `?method=${encodeURIComponent(presetMethod)}` : ''}` })
  }

  return (
    <View className={`page ${themeClass}`}>
      <BackBar fallback="/pages/brew/list/index" />
      <View className="page__header">
        <Text className="eyebrow">SELECT BEAN</Text>
        <Text className="page__title">选择豆子</Text>
        <Text className="dim list-sub">
          {isGreen ? '生豆需要明确选择烘焙炉次' : '成品豆可直接冲煮'}
        </Text>
      </View>

      <View className="page__body">
        {list.length ? (
          <View className="panel panel--flush">
            {list.map((b, i) => (
              <View
                key={b.id}
                className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                onClick={() => pickBean(b.id)}
              >
                <View className="list-row__main">
                  <Text className="list-row__title">{b.name}</Text>
                  <Text className="mute list-row__sub">
                    {b.kind === 'green'
                      ? '生豆'
                      : b.kind === 'purchased_roasted'
                        ? '成品豆'
                        : '待确认类型'}
                    {' · '}
                    {b.origin.country}
                    {b.origin.region ? ` ${b.origin.region}` : ''}
                  </Text>
                </View>
                <View className="list-row__side">
                  {selectedBeanId === b.id && (
                    <Text className="mono list-row__score">✓</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="empty">豆仓还是空的，先去添加一支豆子</View>
        )}

        {/* 生豆：选炉次 */}
        {isGreen && (
          <View className="block">
            <Text className="section-title">烘焙炉次</Text>
            {beanRoasts.length ? (
              <View className="panel panel--flush">
                {beanRoasts.map((r, i) => (
                  <View
                    key={r.id}
                    className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                    onClick={() => setSelectedRoastId(r.id)}
                  >
                    <View className="list-row__main">
                      <Text className="list-row__title mono">{r.batchNo}</Text>
                      <Text className="mute list-row__sub">
                        {r.roastLevel && `${ROAST_LEVEL_LABELS[r.roastLevel]} · `}
                        {r.roaster} · 投豆 {r.greenGrams}g → 出豆 {r.outGrams}g
                      </Text>
                    </View>
                    <View className="list-row__side">
                      {selectedRoastId === r.id && (
                        <Text className="mono list-row__score">✓</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View className="empty empty--inline">
                这支生豆还没有已完成的烘焙批次，请先烘焙
              </View>
            )}
          </View>
        )}

        <View className="actions">
          <View className="btn btn--primary" onClick={next}>
            下一步 · 选择方式
          </View>
        </View>
      </View>
    </View>
  )
}
