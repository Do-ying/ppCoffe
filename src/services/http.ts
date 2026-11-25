import Taro from '@tarojs/taro'

/**
 * HTTP 客户端与传输层抽象
 *
 * 前端与后端通过这一层解耦：
 *   - mockTransport：本地内存 DB，后端未就绪时前端可完整开发
 *   - realTransport：真实 HTTP 请求
 * 两者接口签名完全一致，通过 TARO_APP_API_MODE 切换。
 */

export interface ApiError {
  code: string
  message: string
  details?: unknown
  field?: string
}

export interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: ApiError
  meta?: {
    requestId?: string
    pagination?: { nextCursor?: string; hasMore?: boolean; limit?: number }
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  /** 路径，如 /brews */
  url: string
  data?: unknown
  /** 查询参数 */
  params?: Record<string, string | number | boolean | undefined | null>
  timeout?: number
}

export interface Transport {
  request<T>(options: RequestOptions): Promise<T>
}

export class ApiRequestError extends Error {
  code: string
  details?: unknown
  field?: string

  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ApiRequestError'
    this.code = error.code
    this.details = error.details
    this.field = error.field
  }
}

const BASE_URL = process.env.TARO_APP_API_BASE_URL || 'http://127.0.0.1:8000/api/v1'
const TOKEN_KEY = 'ppcoffe.token'

export function getToken(): string {
  try {
    return Taro.getStorageSync(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string) {
  try {
    Taro.setStorageSync(TOKEN_KEY, token)
  } catch {
    /* 忽略存储异常 */
  }
}

/** 真实 HTTP 传输 */
export const realTransport: Transport = {
  async request<T>(options: RequestOptions): Promise<T> {
    const { method = 'GET', url, data, params, timeout = 15000 } = options

    let query = ''
    if (params) {
      const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
      if (entries.length) {
        query =
          '?' +
          entries
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&')
      }
    }

    const token = getToken()
    const res = await Taro.request({
      url: `${BASE_URL}${url}${query}`,
      method,
      data: data as Taro.request.Option['data'],
      timeout,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })

    const body = (res.data || {}) as ApiEnvelope<T>
    if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
      return body.data as T
    }
    throw new ApiRequestError(
      body.error ?? { code: 'INTERNAL', message: `请求失败（${res.statusCode}）` }
    )
  }
}

export interface HttpClient {
  get<T>(url: string, params?: RequestOptions['params']): Promise<T>
  post<T>(url: string, data?: unknown): Promise<T>
  patch<T>(url: string, data?: unknown): Promise<T>
  del<T>(url: string, params?: RequestOptions['params']): Promise<T>
}

/** 创建绑定到指定 transport 的客户端 */
export function createClient(transport: Transport): HttpClient {
  return {
    get: <T>(url: string, params?: RequestOptions['params']) =>
      transport.request<T>({ method: 'GET', url, params }),
    post: <T>(url: string, data?: unknown) => transport.request<T>({ method: 'POST', url, data }),
    patch: <T>(url: string, data?: unknown) => transport.request<T>({ method: 'PATCH', url, data }),
    del: <T>(url: string, params?: RequestOptions['params']) =>
      transport.request<T>({ method: 'DELETE', url, params })
  }
}
