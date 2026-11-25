import type { Bean, BrewImage, BrewMethod, BrewRecord, Equipment, FlavorDefect, RoastBatch } from '../domain/types'
import type { FlavorCategory } from '../domain/flavor'
import type { Diagnosis } from '../domain/diagnosis'
import { createClient, realTransport, type HttpClient } from './http'
import { mockTransport } from '../mock/db'

/**
 * 服务层：一个端点一个函数，页面只依赖这里的语义化 API。
 * mock / real 传输层在此切换，业务代码无感知。
 */

const API_MODE = (process.env.TARO_APP_API_MODE || 'mock') as 'mock' | 'real'

export const isMockMode = API_MODE === 'mock'

export const client: HttpClient = createClient(isMockMode ? mockTransport : realTransport)

export interface BeanList {
  items: Bean[]
}
export interface BrewList {
  items: BrewRecord[]
}
export interface RoastList {
  items: RoastBatch[]
}
export interface MethodList {
  items: BrewMethod[]
}
export interface FlavorWheel {
  version: string
  categories: FlavorCategory[]
  defects: FlavorDefect[]
}

export interface SummaryBean {
  beanId: string
  name: string
  roastDate: string
  daysSinceRoast: number
  stage: 'resting' | 'peak' | 'fading'
}

export interface StatsSummary {
  today: { brewCount: number; roastCount: number; avgFlavor: number }
  week: { brewCount: number; avgFlavor: number; byMethod: Record<string, number> }
  restingBeans: SummaryBean[]
  activeSession: { type: 'brew' | 'roast'; id: string } | null
}

export interface DerivedCurve {
  points: { t: number; w: number; flow: number; stage: string }[]
  stages: { from: number; to: number; label: string; stage: string }[]
  meta: { generator: string; pointCount?: number }
}

export interface EquipmentList {
  items: Equipment[]
}

/**
 * 上传目标
 *
 * 具体对象存储（MinIO / S3 / OSS…）由后端决定，前端只消费这四个字段，
 * 不绑定任何存储实现细节。
 */
export interface UploadTarget {
  /** 对象键 */
  objectKey: string
  /** 直传地址（预签名 PUT） */
  uploadUrl: string
  /** 访问地址 */
  publicUrl: string
  headers?: Record<string, string>
}

export const api = {
  /* 元数据 */
  methods: () => client.get<MethodList>('/methods'),
  flavorWheel: () => client.get<FlavorWheel>('/flavor-wheel'),

  /* 豆子 */
  listBeans: () => client.get<BeanList>('/beans'),
  getBean: (id: string) => client.get<Bean>(`/beans/${id}`),
  createBean: (data: Partial<Bean>) => client.post<Bean>('/beans', data),
  updateBean: (id: string, data: Partial<Bean>) => client.patch<Bean>(`/beans/${id}`, data),
  beanBrews: (id: string) => client.get<BrewList>(`/beans/${id}/brews`),
  beanRoasts: (id: string) => client.get<RoastList>(`/beans/${id}/roasts`),

  /* 冲煮 */
  listBrews: (params?: { method?: string; beanId?: string; from?: string; to?: string }) =>
    client.get<BrewList>('/brews', params),
  getBrew: (id: string) => client.get<BrewRecord>(`/brews/${id}`),
  createBrew: (data: Partial<BrewRecord>) => client.post<BrewRecord>('/brews', data),
  updateBrew: (id: string, data: Partial<BrewRecord>) => client.patch<BrewRecord>(`/brews/${id}`, data),
  deleteBrew: (id: string) => client.del<{ ok: boolean }>(`/brews/${id}`),
  deriveCurve: (data: {
    method: string
    params: Record<string, number>
    steps?: { atSecond: number; toGrams: number; label?: string; stage?: string }[]
  }) => client.post<DerivedCurve>('/brews/derive-curve', data),
  getDiagnosis: (id: string) => client.get<Diagnosis>(`/brews/${id}/diagnosis`),

  /* 烘豆 */
  listRoasts: () => client.get<RoastList>('/roasts'),
  getRoast: (id: string) => client.get<RoastBatch>(`/roasts/${id}`),
  createRoast: (data: Partial<RoastBatch>) => client.post<RoastBatch>('/roasts', data),

  /* 器具 */
  listEquipment: () => client.get<EquipmentList>('/equipment'),
  createEquipment: (data: Partial<Equipment>) => client.post<Equipment>('/equipment', data),
  updateEquipment: (id: string, data: Partial<Equipment>) =>
    client.patch<Equipment>(`/equipment/${id}`, data),
  deleteEquipment: (id: string) => client.del<{ ok: boolean }>(`/equipment/${id}`),

  /* 图片上传（存储由后端决定，前端只认返回的 url / objectKey） */
  presignUpload: (data: { filename: string; contentType?: string; sizeBytes?: number }) =>
    client.post<UploadTarget>('/uploads/presign', data),
  createUpload: (data: { filename: string; dataUri?: string; sizeBytes?: number }) =>
    client.post<BrewImage>('/uploads', data),
  deleteUpload: (objectKey: string) => client.del<{ ok: boolean }>('/uploads', { objectKey }),

  /* 统计 */
  statsSummary: () => client.get<StatsSummary>('/stats/summary')
}
