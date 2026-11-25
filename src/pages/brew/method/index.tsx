import { useMemo } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { BREW_METHODS } from '../../../domain/methods'
import { FLAVOR_AXIS_KEYS, FLAVOR_AXIS_LABELS } from '../../../domain/types'
import { useBrewDraft } from '../../../store/useBrewDraft'
import { chartPalette } from '../../../styles/colors'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'

const CATEGORY_LABEL: Record<string, string> = {
  percolation: '重力渗透',
  immersion: '浸泡',
  pressure: '压力',
  cold: '冷萃'
}

/** 方式的参数区间摘要 */
function methodSignature(m: (typeof BREW_METHODS)[number]) {
  const parts: string[] = []
  const ratio = m.params.ratio
  if (ratio?.range) parts.push(`1:${ratio.range[0]}–${ratio.range[1]}`)
  const temp = m.params.temperature
  if (temp?.range) parts.push(`${temp.range[0]}–${temp.range[1]}℃`)
  const time = m.params.brewSeconds
  if (time?.range) {
    const max = time.range[1]
    parts.push(max >= 3600 ? `${Math.round(max / 3600)}h` : `${time.range[0]}–${max}s`)
  }
  return parts.join(' · ')
}

export default function MethodPage() {
  const { theme, themeClass } = useResolvedTheme()
  const router = Taro.useRouter()
  const preset = router.params.method
  const setMethod = useBrewDraft(s => s.setMethod)
  const axisColors = chartPalette(theme).axis

  const grouped = useMemo(() => {
    const map: Record<string, (typeof BREW_METHODS)[number][]> = {}
    BREW_METHODS.forEach(m => {
      if (!map[m.category]) map[m.category] = []
      map[m.category].push(m)
    })
    return map
  }, [])

  const choose = (id: string) => {
    setMethod(id)
    Taro.navigateTo({ url: '/pages/brew/params/index' })
  }

  return (
    <View className={`page ${themeClass}`}>
      <View className="page__header">
        <Text className="eyebrow">BREW METHOD</Text>
        <Text className="page__title">选择冲煮方式</Text>
        <Text className="dim method-sub">
          方式决定了参数区间与目标风味，选择后表单与词库会随之联动
        </Text>
      </View>

      <View className="page__body">
        {Object.keys(grouped).map(cat => (
          <View className="block" key={cat}>
            <Text className="eyebrow method-cat">{CATEGORY_LABEL[cat]}</Text>
            <View className="method-list">
              {grouped[cat].map(m => (
                <View
                  key={m.id}
                  className={preset === m.id ? 'method method--active' : 'method'}
                  onClick={() => choose(m.id)}
                >
                  <View className="method__head">
                    <Text className="method__name">{m.name}</Text>
                    <Text className="mono method__sig">{methodSignature(m)}</Text>
                  </View>
                  <Text className="mute method__summary">{m.summary}</Text>

                  {/* 目标风味基线：六轴迷你条 */}
                  <View className="method__baseline">
                    {FLAVOR_AXIS_KEYS.map((k, i) => (
                      <View className="axis-mini" key={k}>
                        <View className="axis-mini__track">
                          <View
                            className="axis-mini__fill"
                            style={{
                              height: `${m.flavorBaseline[k] * 10}%`,
                              background: axisColors[i]
                            }}
                          />
                        </View>
                        <Text className="axis-mini__label">{FLAVOR_AXIS_LABELS[k].slice(0, 2)}</Text>
                      </View>
                    ))}
                  </View>

                  <Text className="method__grind">研磨 {m.grindHint}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}
