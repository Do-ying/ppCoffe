import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../../services'
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

export default function BeanListPage() {
  const { themeClass } = useResolvedTheme()
  const { data: beans } = useQuery({ queryKey: ['beans'], queryFn: api.listBeans })
  const { data: brews } = useQuery({ queryKey: ['brews'], queryFn: () => api.listBrews() })
  const { data: roasts } = useQuery({ queryKey: ['roasts'], queryFn: api.listRoasts })

  const rows = useMemo(
    () =>
      (beans?.items ?? []).map(b => {
        const days = Math.floor((Date.now() - new Date(b.roastDate).getTime()) / 86400000)
        return {
          bean: b,
          days,
          stage: days < 7 ? 'resting' : days <= 21 ? 'peak' : 'fading',
          brewCount: (brews?.items ?? []).filter(x => x.beanId === b.id).length,
          roastCount: (roasts?.items ?? []).filter(x => x.beanId === b.id).length
        }
      }),
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
                  <Text className="bean__name">{bean.name}</Text>
                  <Text className="bean__score mono">{days}天</Text>
                </View>
                <Text className="mute bean__sub">
                  {bean.roaster} · {bean.origin.country}
                  {bean.origin.region ? ` ${bean.origin.region}` : ''}
                </Text>
                <View className="bean__tags">
                  <Text className="tag">{ROAST_LABEL[bean.roastLevel]}</Text>
                  <Text className="tag">{PROCESS_LABEL[bean.process]}</Text>
                  {bean.tags.map(t => (
                    <Text className="tag" key={t}>
                      {t}
                    </Text>
                  ))}
                </View>
                <View className="bean__foot">
                  <Text className="mono mute">烘焙 {bean.roastDate}</Text>
                  <Text className="mono mute">剩余 {bean.remainingGrams}g</Text>
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
