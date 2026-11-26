import { View, Text } from '@tarojs/components'
import {
  THEME_MODE_HINTS,
  THEME_MODE_LABELS,
  useResolvedTheme,
  useTheme,
  type ThemeMode
} from '../../store/useTheme'
import BackBar from '../../components/back-bar'

import './index.scss'

const MODES: ThemeMode[] = ['dark', 'light', 'auto']
const VERSION = '0.1.0'

export default function SettingsPage() {
  const { themeClass } = useResolvedTheme()
  const mode = useTheme(s => s.mode)
  const setMode = useTheme(s => s.setMode)

  return (
    <View className={`page ${themeClass}`}>
      <BackBar fallback="/pages/home/index" />
      <View className="page__header">
        <Text className="eyebrow">SETTINGS</Text>
        <Text className="page__title">设置</Text>
      </View>

      <View className="page__body">
        {/* 外观 */}
        <View className="block">
          <Text className="section-title">外观</Text>
          <View className="theme-picker">
            {MODES.map(m => (
              <View
                key={m}
                className={mode === m ? 'theme-opt theme-opt--active' : 'theme-opt'}
                onClick={() => setMode(m)}
              >
                <Text className="theme-opt__label">{THEME_MODE_LABELS[m]}</Text>
                <Text className="theme-opt__hint">{THEME_MODE_HINTS[m]}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 版本 */}
        <View className="block">
          <View className="panel">
            <View className="data-row">
              <Text className="data-row__label">版本</Text>
              <Text className="data-row__value">v{VERSION}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
