import { useMemo } from 'react'
import { View, Text, Slider, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useQuery } from '@tanstack/react-query'
import { METHOD_MAP, calcRatio, validateParams } from '../../../domain/methods'
import { useBrewDraft } from '../../../store/useBrewDraft'
import { api } from '../../../services'

import './index.scss'
import { useResolvedTheme } from '../../../store/useTheme'
import BackBar from '../../../components/back-bar'

export default function ParamsPage() {
  const { themeClass } = useResolvedTheme()
  const draft = useBrewDraft(s => s.draft)
  const setParam = useBrewDraft(s => s.setParam)
  const toggleEquipment = useBrewDraft(s => s.toggleEquipment)
  const method = METHOD_MAP[draft.methodId]

  const { data: equipmentList } = useQuery({
    queryKey: ['equipment'],
    queryFn: api.listEquipment
  })

  const equipment = equipmentList?.items ?? []
  const grinders = equipment.filter(e => e.type === 'grinder')
  const brewers = equipment.filter(
    e => e.type === 'dripper' || e.type === 'brewer' || e.type === 'espresso' || e.type === 'scale'
  )
  const selectedGrinder = grinders.find(g => draft.equipmentIds.includes(g.id))

  const ratio = calcRatio(draft.params)
  const issues = useMemo(
    () => validateParams(draft.methodId, draft.params as never),
    [draft.methodId, draft.params]
  )

  if (!method) {
    return (
      <View className={`page ${themeClass}`}>
        <BackBar fallback="/pages/brew/list/index" />
        <View className="empty">请先选择冲煮方式</View>
      </View>
    )
  }

  const ratioSpec = method.params.ratio
  const ratioIssue = issues.find(i => i.field === 'ratio')

  return (
    <View className="page">
      <BackBar fallback="/pages/brew/list/index" />
      <View className="page__header">
        <Text className="eyebrow">{method.category.toUpperCase()}</Text>
        <Text className="page__title">{method.name}</Text>
        <Text className="dim method-sub">{method.summary}</Text>
      </View>

      <View className="page__body">
        {/* 粉液比读数 */}
        <View className="ratio-box">
          <View>
            <Text className="eyebrow">粉水比 / BREW RATIO</Text>
            <Text className="ratio-box__value mono">1 : {ratio.toFixed(2)}</Text>
          </View>
          {ratioSpec?.range && (
            <View className="ratio-box__range">
              <Text className="mute">建议区间</Text>
              <Text className="mono">1:{ratioSpec.range[0]} – 1:{ratioSpec.range[1]}</Text>
            </View>
          )}
        </View>

        {ratioIssue && (
          <View className={ratioIssue.severity === 'error' ? 'issue issue--error' : 'issue'}>
            <Text className={ratioIssue.severity === 'error' ? 'danger' : 'warn'}>
              {ratioIssue.severity === 'error' ? '偏差过大' : '略偏离区间'}：当前 1:
              {ratio.toFixed(2)}，该方式建议 1:{ratioSpec?.range?.[0]}–1:{ratioSpec?.range?.[1]}
            </Text>
          </View>
        )}

        {/* 参数表单 */}
        <View className="block">
          <Text className="section-title">冲煮参数</Text>
          {Object.values(method.params)
            .filter(p => p.key !== 'ratio')
            .map(spec => {
              const value = (draft.params as never as Record<string, number | string | undefined>)[
                spec.key
              ]
              const num = typeof value === 'number' ? value : spec.default ?? 0
              const issue = issues.find(i => i.field === spec.key)
              return (
                <View className="param" key={spec.key}>
                  <View className="param__head">
                    <Text className="param__label">
                      {spec.key === 'grindSetting' ? '研磨度参考' : spec.label}
                    </Text>
                    <Text className="mono param__value">
                      {spec.key === 'grindSetting'
                        ? draft.params.grindSetting || '见下方输入'
                        : `${num}${spec.unit ?? ''}`}
                    </Text>
                  </View>
                  {spec.range && (
                    <>
                      <Slider
                        className="param__slider"
                        min={spec.range[0]}
                        max={spec.range[1]}
                        step={spec.key === 'temperature' ? 1 : 1}
                        value={num}
                        activeColor="#7FD1C1"
                        backgroundColor="#242927"
                        blockColor="#E8EDE8"
                        blockSize={16}
                        onChanging={e => setParam(spec.key as never, e.detail.value)}
                        onChange={e => setParam(spec.key as never, e.detail.value)}
                      />
                      <Text className="param__range mono">
                        {spec.range[0]} – {spec.range[1]} {spec.unit ?? ''}
                      </Text>
                    </>
                  )}
                  {spec.hint && <Text className="param__hint mute">{spec.hint}</Text>}
                  {issue && (
                    <Text className={issue.severity === 'error' ? 'danger param__issue' : 'warn param__issue'}>
                      {issue.label}超出建议区间
                    </Text>
                  )}
                </View>
              )
            })}
        </View>

        {/* 器具 */}
        <View className="block">
          <View className="block__head">
            <Text className="section-title">器具</Text>
            <Text className="mute" onClick={() => Taro.navigateTo({ url: '/pages/equipment/list/index' })}>
              管理
            </Text>
          </View>

          {grinders.length > 0 && (
            <>
              <Text className="group-label">磨豆机</Text>
              <View className="chips">
                {grinders.map(g => (
                  <View
                    key={g.id}
                    className={draft.equipmentIds.includes(g.id) ? 'tag tag--active' : 'tag'}
                    onClick={() => toggleEquipment(g.id)}
                  >
                    {g.name}
                  </View>
                ))}
              </View>
            </>
          )}

          {brewers.length > 0 && (
            <>
              <Text className="group-label">冲煮器具</Text>
              <View className="chips">
                {brewers.map(g => (
                  <View
                    key={g.id}
                    className={draft.equipmentIds.includes(g.id) ? 'tag tag--active' : 'tag'}
                    onClick={() => toggleEquipment(g.id)}
                  >
                    {g.name}
                  </View>
                ))}
              </View>
            </>
          )}

          {!equipment.length && (
            <View className="empty empty--inline">还没有添加器具，先去「管理」里创建</View>
          )}
        </View>

        {/* 研磨度 */}
        <View className="block">
          <Text className="section-title">研磨度</Text>
          <View className="form">
            <View className="form__row">
              <Text className="form__label">刻度</Text>
              <Input
                className="form__input"
                value={draft.params.grindSetting || ''}
                placeholder={selectedGrinder ? '如 #22 / 刻度 18' : '如 22 格'}
                onInput={e => setParam('grindSetting' as never, e.detail.value)}
              />
            </View>
          </View>
          {selectedGrinder?.notes && (
            <Text className="param__hint mute">
              {selectedGrinder.name} 基准：{selectedGrinder.notes}
            </Text>
          )}
        </View>

        <View className="actions">
          <View
            className="btn btn--primary"
            onClick={() => Taro.navigateTo({ url: '/pages/brew/flavor/index' })}
          >
            下一步 · 记录风味
          </View>
        </View>
      </View>
    </View>
  )
}
