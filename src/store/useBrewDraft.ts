import { create } from 'zustand'
import type {
  BrewImage,
  BrewParams,
  BrewStep,
  CurveStage,
  FlavorAxes,
  TempStage
} from '../domain/types'
import { BREW_METHODS, calcRatio } from '../domain/methods'
import { generatePlanCurve } from '../domain/curve/generate'

/**
 * 冲煮草稿状态
 *
 * 跨页面共享（方式选择 → 参数 → 曲线 → 风味 → 保存），
 * 放在 Zustand 而非页面 state，避免小程序端 setData 频繁传递大对象。
 */

export interface BrewDraft {
  /** 当前选择的冲煮方式 id */
  methodId: string
  params: BrewParams
  steps: BrewStep[]
  axes: FlavorAxes
  descriptors: { id: string; label: string; category: string; intensity: number; tempStage: TempStage }[]
  defects: { id: string; label: string; severity: number }[]
  tempStage: TempStage
  note: string
  /** 评鉴内容（长文本） */
  review: string
  /** 本次使用的器具 id */
  equipmentIds: string[]
  /** 附图 */
  images: BrewImage[]
  beanId?: string
  /** 记录深度档位 */
  depth: 'quick' | 'standard' | 'cupping'
}

const defaultAxes: FlavorAxes = {
  acidity: 5,
  sweetness: 5,
  body: 5,
  flavor: 5,
  aftertaste: 5,
  balance: 5
}

const firstMethod = BREW_METHODS[0]

function initialParams(methodId: string): BrewParams {
  const method = BREW_METHODS.find(m => m.id === methodId) ?? firstMethod
  const dose = method.params.doseGrams?.default ?? 15
  const water = method.params.waterGrams?.default ?? 250
  const params: BrewParams = {
    doseGrams: dose,
    waterGrams: water,
    yieldGrams: method.params.yieldGrams?.default ?? Math.round(water * 0.9),
    brewSeconds: method.params.brewSeconds?.default ?? 165,
    temperature: method.params.temperature?.default ?? 93,
    preinfusionSeconds: method.params.preinfusionSeconds?.default,
    grindSetting: method.params.grindSetting?.hint
  }
  params.ratio = calcRatio(params)
  return params
}

interface BrewDraftState {
  draft: BrewDraft
  /** 切换冲煮方式：重置参数为该方式默认值，并带出默认注水计划 */
  setMethod: (methodId: string) => void
  setParam: (key: keyof BrewParams, value: number | string | undefined) => void
  setSteps: (steps: BrewStep[]) => void
  setAxis: (axis: keyof FlavorAxes, value: number) => void
  toggleDescriptor: (d: { id: string; label: string; category: string }, intensity?: number) => void
  toggleDefect: (d: { id: string; label: string }) => void
  setTempStage: (t: TempStage) => void
  setNote: (n: string) => void
  setReview: (r: string) => void
  toggleEquipment: (id: string) => void
  addImage: (img: BrewImage) => void
  removeImage: (id: string) => void
  setBeanId: (id: string) => void
  setDepth: (d: BrewDraft['depth']) => void
  reset: () => void
}

export const useBrewDraft = create<BrewDraftState>((set, get) => ({
  draft: {
    methodId: firstMethod.id,
    params: initialParams(firstMethod.id),
    steps: firstMethod.defaultSteps,
    axes: { ...defaultAxes },
    descriptors: [],
    defects: [],
    tempStage: 'warm',
    note: '',
    review: '',
    equipmentIds: [],
    images: [],
    depth: 'quick'
  },

  setMethod: methodId => {
    const method = BREW_METHODS.find(m => m.id === methodId)
    if (!method) return
    set({
      draft: {
        ...get().draft,
        methodId,
        params: initialParams(methodId),
        steps: method.defaultSteps
      }
    })
  },

  setParam: (key, value) => {
    const draft = get().draft
    const params = { ...draft.params, [key]: value } as BrewParams
    params.ratio = calcRatio(params)
    set({ draft: { ...draft, params } })
  },

  setSteps: steps => set({ draft: { ...get().draft, steps } }),

  setAxis: (axis, value) => {
    const draft = get().draft
    set({ draft: { ...draft, axes: { ...draft.axes, [axis]: value } } })
  },

  toggleDescriptor: (d, intensity = 6) => {
    const draft = get().draft
    const exists = draft.descriptors.some(x => x.id === d.id)
    const descriptors = exists
      ? draft.descriptors.filter(x => x.id !== d.id)
      : [...draft.descriptors, { ...d, intensity, tempStage: draft.tempStage }]
    set({ draft: { ...draft, descriptors } })
  },

  toggleDefect: d => {
    const draft = get().draft
    const exists = draft.defects.some(x => x.id === d.id)
    const defects = exists
      ? draft.defects.filter(x => x.id !== d.id)
      : [...draft.defects, { ...d, severity: 1 }]
    set({ draft: { ...draft, defects } })
  },

  setTempStage: tempStage => set({ draft: { ...get().draft, tempStage } }),

  setNote: note => set({ draft: { ...get().draft, note } }),

  setReview: review => set({ draft: { ...get().draft, review } }),

  toggleEquipment: id => {
    const draft = get().draft
    const equipmentIds = draft.equipmentIds.includes(id)
      ? draft.equipmentIds.filter(x => x !== id)
      : [...draft.equipmentIds, id]
    set({ draft: { ...draft, equipmentIds } })
  },

  addImage: img => {
    const draft = get().draft
    set({ draft: { ...draft, images: [...draft.images, img] } })
  },

  removeImage: id => {
    const draft = get().draft
    set({ draft: { ...draft, images: draft.images.filter(x => x.id !== id) } })
  },

  setBeanId: beanId => set({ draft: { ...get().draft, beanId } }),

  setDepth: depth => set({ draft: { ...get().draft, depth } }),

  reset: () =>
    set({
      draft: {
        methodId: firstMethod.id,
        params: initialParams(firstMethod.id),
        steps: firstMethod.defaultSteps,
        axes: { ...defaultAxes },
        descriptors: [],
        defects: [],
        tempStage: 'warm',
        note: '',
        review: '',
        equipmentIds: [],
        images: [],
        depth: 'quick'
      }
    })
}))

/** 从草稿生成曲线（供曲线页与详情页复用） */
export function draftCurve(draft: BrewDraft) {
  return generatePlanCurve(draft.steps, draft.params.brewSeconds)
}

/** 阶段色板（与设计令牌保持一致） */
export const STAGE_COLORS: Record<CurveStage, string> = {
  preinfusion: '#6C9BD1',
  bloom: '#7FD1C1',
  extraction: '#5FA8A0',
  drawdown: '#E9B44C'
}
