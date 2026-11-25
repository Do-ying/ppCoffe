import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import './app.scss'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
})

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    console.log(
      '[ppCoffe] launched, api mode =',
      process.env.TARO_APP_API_MODE || 'mock'
    )
  })

  // children 是将要会渲染的页面
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export default App
