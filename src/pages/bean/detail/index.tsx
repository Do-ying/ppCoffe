import { useMemo, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS } from '../../../domain/types'
import { BREW_METHODS } from '../../../domain/methods'
import { useResolvedTheme } from '../../../store/useTheme'
import Icon from '../../../components/icon'

import './index.scss'

const PROCESS_LABEL: Record<string, string> = {
  washed: '水洗',
  natural: '日晒',
  honey: '蜜处理',
  anaerobic: '厌氧',
  other: '其他'
}

const STAGE_LABEL: Record<string, string> = {
  resting: '养豆期',
  peak: '赏味期',
  fading: '风味衰减',
  unknown: '烘焙日期未知'
}

const REST_EVENT_LABEL: Record<string, string> = {
  opened: '开袋',
  sealed: '密封',
  divided: '分装',
  note: '养豆备注'
}

export default function BeanDetailPage() {
  const { themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const queryClient = useQueryClient()
  const [failedCoverUrl, setFailedCoverUrl] = useState<string>()
  const beanId = router.params.id as string

  const { data: bean } = useQuery({
    queryKey: ['bean', beanId], queryFn: () => api.getBean(beanId), enabled: !!beanId
  })
  const { data: brews } = useQuery({
    queryKey: ['beanBrews', beanId], queryFn: () => api.beanBrews(beanId), enabled: !!beanId
  })
  const { data: roasts } = useQuery({
    queryKey: ['beanRoasts', beanId], queryFn: () => api.beanRoasts(beanId), enabled: !!beanId
  })
  const { data: restEventsData } = useQuery({
    queryKey: ['restEvents', beanId],
    queryFn: () => api.listRestEvents(beanId),
    enabled: !!beanId
  })
  const restEvents = restEventsData?.items ?? []

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

  // 养豆阶段由后端统一计算（与首页摘要同一套口径），前端不再各算一套
  const stage = bean.restStage?.stage ?? 'unknown'
  const days = bean.restStage?.days ?? 0

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
        <View className="bean__badges">
          {bean.kind ? (
            <Text className="tag tag--active">
              {bean.kind === 'green' ? '生豆' : '成品豆'}
            </Text>
          ) : (
            <Text className="tag tag--danger">待确认类型</Text>
          )}
        </View>
      </View>

      <View className="page__body">
        {/* 封面 */}
        {bean.imageUrl && bean.imageUrl !== failedCoverUrl ? (
          <Image
            className="bean-detail__cover"
            src={bean.imageUrl}
            mode="aspectFill"
            onClick={() =>
              Taro.previewImage({ urls: [bean.imageUrl as string], current: bean.imageUrl as string })
            }
            onError={() => setFailedCoverUrl(bean.imageUrl as string)}
          />
        ) : (
          <View className="bean-detail__cover bean-detail__cover--empty"><Icon name="bean" size={34} /></View>
        )}

        {/* 档案 */}
        <View className="panel">
          <View className="data-row">
            <Text className="data-row__label">处理法{bean.kind === 'green' ? '' : ' / 烘焙度'}</Text>
            <Text className="data-row__value">
              {PROCESS_LABEL[bean.process]}
              {bean.kind !== 'green' && bean.roastLevel && ` · ${ROAST_LEVEL_LABELS[bean.roastLevel]}`}
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">{bean.kind === 'green' ? '最近烘焙' : '烘焙日期'}</Text>
            <Text className="data-row__value">
              {bean.restStage?.roastDate ? `${bean.restStage.roastDate}（${days} 天）`
                : bean.kind === 'green' ? '尚无已完成炉次' : '未知'}
            </Text>
          </View>
          <View className="data-row">
            <Text className="data-row__label">养豆状态</Text>
            <Text
              className={
                stage === 'peak'
                  ? 'data-row__value signal'
                  : stage === 'resting'
                    ? 'data-row__value warn'
                    : stage === 'unknown'
                      ? 'data-row__value mute'
                      : 'data-row__value danger'
              }
            >
              {STAGE_LABEL[stage]}
            </Text>
          </View>
          {bean.kind === 'green' ? (
            <>
              <View className="data-row">
                <Text className="data-row__label">购入 / 已用</Text>
                <Text className="data-row__value">
                  {bean.weightGrams} g
                  {bean.usedGreenGrams == null
                    ? ' · 库存待核对'
                    : ` / 已用 ${bean.usedGreenGrams} g`}
                </Text>
              </View>
              <View className="data-row">
                <Text className="data-row__label">剩余生豆</Text>
                <Text className="data-row__value">
                  {bean.remainingGrams == null ? '库存待核对' : `${bean.remainingGrams} g`}
                </Text>
              </View>
            </>
          ) : (
            <View className="data-row">
              <Text className="data-row__label">剩余</Text>
              <Text className="data-row__value">
                {bean.remainingGrams === undefined ? '—' : `${bean.remainingGrams} g`}
              </Text>
            </View>
          )}
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
            {bean.kind && <Text
              className="mute"
              onClick={() => {
                Taro.navigateTo({ url: `/pages/brew/bean/index?beanId=${beanId}` })
              }}
            >
              + 冲煮
            </Text>}
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
                      {bean.kind === 'green' && ` · ${b.roastBatchId
                        ? beanRoasts.find(r => r.id === b.roastBatchId)?.batchNo ?? '炉次'
                        : '历史未指定'}`}
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
        {(bean.kind === 'green' || beanRoasts.length > 0) && <View className="block">
          <View className="block__head">
            <Text className="section-title">烘焙批次</Text>
            <View className="block__actions">
              <Text
                className="mute"
                onClick={() => Taro.navigateTo({ url: '/pages/roast/list/index' })}
              >
                查看全部
              </Text>
              {bean.kind === 'green' && <Text
                className="mute"
                onClick={() =>
                  Taro.navigateTo({ url: `/pages/roast/edit/index?beanId=${beanId}` })
                }
              >
                + 烘焙
              </Text>}
            </View>
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
                      {[r.roastLevel && ROAST_LEVEL_LABELS[r.roastLevel], r.roaster,
                        `失重 ${r.weightLossPercent}%`, `DTR ${r.dtrPercent}%`].filter(Boolean).join(' · ')}
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
        </View>}

        {/* 养豆事件 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">养豆事件</Text>
            {bean.kind && <Text
              className="mute"
              onClick={() => Taro.navigateTo({ url: `/pages/bean/rest/index?beanId=${beanId}` })}
            >
              登记
            </Text>}
          </View>
          {restEvents.length ? (
            <View className="panel panel--flush">
              {restEvents.map((e, i) => (
                <View
                  key={e.id}
                  className={i > 0 ? 'list-row list-row--bordered' : 'list-row'}
                >
                  <View className="list-row__main">
                    <Text className="list-row__title">
                      {REST_EVENT_LABEL[e.type] || e.type}
                    </Text>
                    <Text className="mute list-row__sub">
                      {new Date(e.occurredAt).toLocaleDateString()}
                      {e.roastBatchId
                        ? ` · ${beanRoasts.find(r => r.id === e.roastBatchId)?.batchNo ?? '炉次'}`
                        : ' · 购入批次'}
                      {e.note ? ` · ${e.note}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="empty empty--inline">还没有养豆事件</View>
          )}
        </View>

        {/* 每克成本：两种豆子统一公式 —— 实付豆款 ÷ 购入克数 */}
        <View className="panel bean__cost">
          <View className="data-row">
            <Text className="data-row__label">每克成本</Text>
            <Text className="data-row__value">
              {bean.costPerGram == null
                ? '未填写采购价'
                : `¥${bean.costPerGram.toFixed(4)}／克`}
            </Text>
          </View>
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
