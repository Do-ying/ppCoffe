import { useMemo, useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
import { ROAST_LEVEL_LABELS } from '../../../domain/types'
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
  resting: '养豆中',
  peak: '赏味期',
  fading: '风味衰减',
  unknown: '日期未知'
}

/** 豆子类型标签（kind 为空表示旧数据待确认） */
const KIND_LABEL: Record<string, string> = {
  green: '生豆',
  purchased_roasted: '成品豆'
}

export default function BeanListPage() {
  const { themeClass } = useResolvedTheme()
  const [failedCovers, setFailedCovers] = useState<Record<string, string>>({})
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: brews } = useQuery({ queryKey: ['brews'], queryFn: () => api.listBrews() })
  const { data: roasts } = useQuery({ queryKey: ['roasts'], queryFn: api.listRoasts })

  const rows = useMemo(
    () =>
      (beans?.items ?? []).map(b => ({
        bean: b,
        // 养豆阶段由后端统一计算（与豆子详情、首页摘要同一套口径）
        stage: b.restStage?.stage ?? 'unknown',
        days: b.restStage?.days ?? 0,
        brewCount: (brews?.items ?? []).filter(x => x.beanId === b.id).length,
        roastCount: (roasts?.items ?? []).filter(x => x.beanId === b.id).length
      })),
    [beans, brews, roasts]
  )

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">BEAN WAREHOUSE</Text>
        <Text className="page__title">豆仓</Text>
        <Text className="dim list-sub">
          共 {rows.length} 支 · 冲煮与烘焙曲线都挂在具体豆子上
        </Text>
      </View>

      <View className="page__body">
        {rows.length ? (
          <View className="bean-list">
            {rows.map(({ bean, days, stage, brewCount, roastCount }) => (
              <View
                className="bean"
                key={bean.id}
                onClick={() => Taro.navigateTo({ url: `/pages/bean/detail/index?id=${bean.id}` })}
              >
                <View className="bean__head">
                  {bean.imageUrl && failedCovers[bean.id] !== bean.imageUrl ? (
                    <Image className="bean__cover" src={bean.imageUrl} mode="aspectFill"
                      onError={() => setFailedCovers(previous => ({ ...previous, [bean.id]: bean.imageUrl as string }))} />
                  ) : (
                    <View className="bean__cover bean__cover--empty"><Icon name="bean" /></View>
                  )}
                  <View className="bean__head-main">
                    <Text className="bean__name">{bean.name}</Text>
                    <Text className="bean__score mono">
                      {bean.restStage?.days == null ? (bean.kind === 'green' ? '待烘焙' : '日期未知') : `${days}天`}
                    </Text>
                  </View>
                </View>
                <Text className="mute bean__sub">
                  {bean.roaster} · {bean.origin.country}
                  {bean.origin.region ? ` ${bean.origin.region}` : ''}
                </Text>
                <View className="bean__tags">
                  {bean.kind ? (
                    <Text className="tag tag--active">{KIND_LABEL[bean.kind]}</Text>
                  ) : (
                    <Text className="tag tag--danger">待确认类型</Text>
                  )}
                  {bean.kind !== 'green' && bean.roastLevel && (
                    <Text className="tag">{ROAST_LEVEL_LABELS[bean.roastLevel]}</Text>
                  )}
                  <Text className="tag">{PROCESS_LABEL[bean.process]}</Text>
                  {bean.tags.map(t => (
                    <Text className="tag" key={t}>
                      {t}
                    </Text>
                  ))}
                </View>
                <View className="bean__foot">
                  <Text className="mono mute">
                    {bean.restStage?.roastDate
                      ? `烘焙 ${bean.restStage.roastDate}`
                      : bean.kind === 'green' ? '未烘焙' : '烘焙日期未知'}
                  </Text>
                  <Text className="mono mute">
                    {bean.remainingGrams == null
                      ? '库存待核对'
                      : `剩余 ${bean.remainingGrams}g`}
                  </Text>
                  <Text
                    className={
                      stage === 'peak' ? 'signal' : stage === 'resting' ? 'warn' : 'danger'
                    }
                  >
                    {STAGE_LABEL[stage]}
                  </Text>
                  <Text className="mono mute">{brewCount} 冲煮 · {roastCount} 烘焙</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View className="empty">
            豆仓还是空的{'\n'}先添加一支豆子，冲煮与烘焙记录都会挂在它下面
          </View>
        )}

        <View className="actions">
          <View
            className="btn btn--primary"
            onClick={() => Taro.navigateTo({ url: '/pages/bean/edit/index' })}
          >
            添加豆子
          </View>
        </View>
      </View>
    </View>
  )
}
