import Taro from '@tarojs/taro'
import type { BrewImage } from '../domain/types'
import { api, isMockMode } from './index'
import { guessExtension, readImageAsDataUri } from '../platform/image'

/**
 * 图片上传
 *
 * 真实模式：向后端申请 MinIO 预签名直传地址，前端 PUT 直传对象存储，
 *           避免图片流量全部穿过应用服务器。
 * Mock 模式：读取为 data URI 直接内联返回，保证无后端也能演示。
 */

export interface PresignResult {
  /** MinIO 对象键 */
  objectKey: string
  /** 预签名 PUT 地址 */
  uploadUrl: string
  /** 访问用的 URL（公开读或签名读） */
  publicUrl: string
  headers?: Record<string, string>
}

/** 上传一张冲煮记录附图 */
export async function uploadBrewImage(filePath: string, sizeBytes = 0): Promise<BrewImage> {
  const filename = `brew/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${guessExtension(
    filePath
  )}`

  if (isMockMode) {
    const dataUri = await readImageAsDataUri(filePath)
    return api.createUpload({ filename, dataUri, sizeBytes })
  }

  const presign = await api.presignUpload({ filename, contentType: 'image/jpeg', sizeBytes })

  await Taro.uploadFile({
    url: presign.uploadUrl,
    filePath,
    name: 'file',
    header: presign.headers || {},
    success: res => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`上传失败（${res.statusCode}）`)
      }
    }
  })

  return {
    id: `img_${Date.now()}`,
    objectKey: presign.objectKey,
    url: presign.publicUrl,
    sizeBytes
  }
}
