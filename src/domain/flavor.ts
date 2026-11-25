import type { FlavorAxes, FlavorDefect, TempStage } from './types'

/**
 * SCA 风味轮（2016 版，与 World Coffee Research 感官词典对应）
 * 三层结构：9 大类 → 子类 → 具体描述词。
 * 这里只保留精品咖啡记录中真正会用到的描述词，保持录入负担可控。
 */

export interface FlavorSubcategory {
  id: string
  label: string
  descriptors: { id: string; label: string }[]
}

export interface FlavorCategory {
  id: string
  label: string
  color: string
  subcategories: FlavorSubcategory[]
}

export const FLAVOR_CATEGORIES: FlavorCategory[] = [
  {
    id: 'floral',
    label: '花香',
    color: '#E8A0BF',
    subcategories: [
      {
        id: 'floral_light',
        label: '轻柔花香',
        descriptors: [
          { id: 'jasmine', label: '茉莉' },
          { id: 'rose', label: '玫瑰' },
          { id: 'chamomile', label: '洋甘菊' }
        ]
      },
      {
        id: 'floral_intense',
        label: '浓烈花香',
        descriptors: [
          { id: 'lavender', label: '薰衣草' },
          { id: 'honeysuckle', label: '忍冬' },
          { id: 'jasmine_heavy', label: '栀子花' }
        ]
      }
    ]
  },
  {
    id: 'fruity',
    label: '果香',
    color: '#D9573B',
    subcategories: [
      {
        id: 'berry',
        label: '浆果',
        descriptors: [
          { id: 'blueberry', label: '蓝莓' },
          { id: 'raspberry', label: '树莓' },
          { id: 'strawberry', label: '草莓' },
          { id: 'blackberry', label: '黑莓' }
        ]
      },
      {
        id: 'citrus',
        label: '柑橘',
        descriptors: [
          { id: 'lemon', label: '柠檬' },
          { id: 'orange', label: '橙子' },
          { id: 'bergamot', label: '佛手柑' },
          { id: 'lime', label: '青柠' }
        ]
      },
      {
        id: 'stone_fruit',
        label: '核果',
        descriptors: [
          { id: 'peach', label: '桃子' },
          { id: 'apricot', label: '杏' },
          { id: 'plum', label: '李子' }
        ]
      },
      {
        id: 'tropical',
        label: '热带水果',
        descriptors: [
          { id: 'mango', label: '芒果' },
          { id: 'passionfruit', label: '百香果' },
          { id: 'pineapple', label: '菠萝' }
        ]
      }
    ]
  },
  {
    id: 'sour_fermented',
    label: '酸 · 发酵',
    color: '#C0392B',
    subcategories: [
      {
        id: 'fermented',
        label: '发酵感',
        descriptors: [
          { id: 'wine', label: '酒感' },
          { id: 'vinegar', label: '醋感' },
          { id: 'kombucha', label: '康普茶' }
        ]
      },
      {
        id: 'sour',
        label: '酸涩（欠萃）',
        descriptors: [
          { id: 'sour_sharp', label: '尖酸' },
          { id: 'sour_acetous', label: '醋酸感' }
        ]
      }
    ]
  },
  {
    id: 'green_vegetal',
    label: '绿 · 植物',
    color: '#5B8C5A',
    subcategories: [
      {
        id: 'green',
        label: '植物感',
        descriptors: [
          { id: 'green_tea', label: '绿茶' },
          { id: 'herbal', label: '草本' },
          { id: 'vegetal', label: '青草' }
        ]
      }
    ]
  },
  {
    id: 'other',
    label: '其他',
    color: '#8E8E8E',
    subcategories: [
      {
        id: 'distinct',
        label: '独特风味',
        descriptors: [
          { id: 'earthy', label: '土壤' },
          { id: 'woody', label: '木质' },
          { id: 'papery', label: '纸板味' },
          { id: 'moldy', label: '霉味' }
        ]
      }
    ]
  },
  {
    id: 'roasted',
    label: '烘烤',
    color: '#7A4A2B',
    subcategories: [
      {
        id: 'roast_basic',
        label: '烘烤调',
        descriptors: [
          { id: 'toast', label: '吐司' },
          { id: 'toasted', label: '烘烤坚果' },
          { id: 'cereal', label: '谷物' }
        ]
      },
      {
        id: 'roast_deep',
        label: '深度烘烤',
        descriptors: [
          { id: 'smoky', label: '烟熏' },
          { id: 'burnt', label: '焦糊' },
          { id: 'pipe_tobacco', label: '烟斗烟草' }
        ]
      }
    ]
  },
  {
    id: 'spices',
    label: '香料',
    color: '#B4643C',
    subcategories: [
      {
        id: 'spice_warm',
        label: '温暖香料',
        descriptors: [
          { id: 'cinnamon', label: '肉桂' },
          { id: 'clove', label: '丁香' },
          { id: 'cardamom', label: '豆蔻' },
          { id: 'nutmeg', label: '肉豆蔻' }
        ]
      },
      {
        id: 'spice_pungent',
        label: '辛香',
        descriptors: [
          { id: 'pepper', label: '胡椒' },
          { id: 'anise', label: '茴香' }
        ]
      }
    ]
  },
  {
    id: 'nutty_cocoa',
    label: '坚果 · 可可',
    color: '#A1704A',
    subcategories: [
      {
        id: 'nutty',
        label: '坚果',
        descriptors: [
          { id: 'almond', label: '杏仁' },
          { id: 'hazelnut', label: '榛果' },
          { id: 'peanut', label: '花生' }
        ]
      },
      {
        id: 'cocoa',
        label: '可可',
        descriptors: [
          { id: 'chocolate', label: '巧克力' },
          { id: 'cocoa_powder', label: '可可粉' },
          { id: 'caramel', label: '焦糖' }
        ]
      }
    ]
  },
  {
    id: 'sweet',
    label: '甜',
    color: '#D9A441',
    subcategories: [
      {
        id: 'sweet_basic',
        label: '糖类',
        descriptors: [
          { id: 'honey', label: '蜂蜜' },
          { id: 'maple', label: '枫糖' },
          { id: 'brown_sugar', label: '红糖' },
          { id: 'molasses', label: '糖蜜' },
          { id: 'vanilla', label: '香草' }
        ]
      }
    ]
  }
]

/** 缺陷清单（SCA 104-2024 缺陷项，简化到常用几条） */
export const FLAVOR_DEFECTS: FlavorDefect[] = [
  { id: 'papery', label: '纸板味', severity: 1 },
  { id: 'moldy', label: '霉味', severity: 2 },
  { id: 'phenolic', label: '酚类', severity: 2 },
  { id: 'fermented_boozy', label: '过发酵酒味', severity: 2 },
  { id: 'rubbery', label: '橡胶味', severity: 2 },
  { id: 'grassy', label: '生青味', severity: 1 },
  { id: 'quakery', label: '发酵粉味', severity: 1 }
]

export const TEMP_STAGE_LABELS: Record<TempStage, string> = {
  hot: '热（约 80℃+）',
  warm: '温（70-75℃ · 最佳表达）',
  cool: '凉（室温）'
}

/** 风味词扁平索引：id -> { label, category } */
export const DESCRIPTOR_INDEX: Record<string, { label: string; category: string }> = (() => {
  const map: Record<string, { label: string; category: string }> = {}
  FLAVOR_CATEGORIES.forEach(c => {
    c.subcategories.forEach(s => {
      s.descriptors.forEach(d => {
        map[d.id] = { label: d.label, category: c.id }
      })
    })
  })
  return map
})()

/** 按方式推荐的类别过滤词库 */
export function descriptorsForCategories(categories: string[]) {
  const allow = new Set(categories)
  const out: { id: string; label: string; category: string; categoryLabel: string }[] = []
  FLAVOR_CATEGORIES.filter(c => allow.has(c.id)).forEach(c => {
    c.subcategories.forEach(s => {
      s.descriptors.forEach(d => {
        out.push({ id: d.id, label: d.label, category: c.id, categoryLabel: c.label })
      })
    })
  })
  return out
}

/** 中性风味画像 */
export function neutralFlavor(): FlavorAxes {
  return { acidity: 5, sweetness: 5, body: 5, flavor: 5, aftertaste: 5, balance: 5 }
}

/** 计算两套六轴的平均差值（实测 - 基线） */
export function axesDelta(actual: FlavorAxes, baseline: FlavorAxes): FlavorAxes {
  return {
    acidity: actual.acidity - baseline.acidity,
    sweetness: actual.sweetness - baseline.sweetness,
    body: actual.body - baseline.body,
    flavor: actual.flavor - baseline.flavor,
    aftertaste: actual.aftertaste - baseline.aftertaste,
    balance: actual.balance - baseline.balance
  }
}

/** 吻合度 0-100：基线与实测的接近程度 */
export function matchScore(actual: FlavorAxes, baseline: FlavorAxes): number {
  const keys = Object.keys(baseline) as (keyof FlavorAxes)[]
  let diff = 0
  keys.forEach(k => {
    diff += Math.abs(actual[k] - baseline[k])
  })
  // 平均每轴差 0 分 = 100 分，每轴差 5 分 ≈ 0 分
  const avg = diff / keys.length
  return Math.max(0, Math.min(100, Math.round(100 - avg * 20)))
}
