import Taro from '@tarojs/taro'

/**
 * 图片选择与读取（跨端）
 *
 * 小程序：wx.chooseMedia / chooseImage + FileSystemManager.readFile(base64)
 * H5    ：<input type="file"> → objectURL → fetch → FileReader
 */

export interface PickedImage {
  /** 临时路径（H5 为 blob: URL） */
  path: string
  size: number
}

/** 选择图片（最多 count 张） */
export async function pickImages(count = 9): Promise<PickedImage[]> {
  if (process.env.TARO_ENV === 'h5') {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = count > 1
      input.onchange = () => {
        const files = Array.from(input.files || []).slice(0, count)
        resolve(
          files.map(f => ({
            path: URL.createObjectURL(f),
            size: f.size
          }))
        )
      }
      input.click()
    })
  }

  const res = await Taro.chooseImage({ count, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
  const paths = res.tempFilePaths || []
  const sizes = (res.tempFiles || []).map((f: any) => f.size ?? 0)
  return paths.map((path, i) => ({ path, size: sizes[i] ?? 0 }))
}

/**
 * 读取图片为 data URI
 * 供 Mock 模式直接内联展示（真实模式走 MinIO 直传，不需要这一步）
 */
export async function readImageAsDataUri(path: string): Promise<string> {
  if (process.env.TARO_ENV === 'h5') {
    const blob = await fetch(path).then(r => r.blob())
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(blob)
    })
  }

  const manager = Taro.getFileSystemManager()
  const res = (await manager.readFile({
    filePath: path,
    encoding: 'base64'
  })) as unknown as { data: string }
  return `data:image/jpeg;base64,${res.data}`
}

/** 猜测扩展名 */
export function guessExtension(path: string): string {
  const m = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(path)
  return m ? m[1].toLowerCase() : 'jpg'
}
