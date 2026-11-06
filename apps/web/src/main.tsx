import '@/lib/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider, useAuth } from '@/features/auth/auth-provider'
import { router } from '@/router'
import { syncLanguageWithProfile } from '@/lib/i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function App() {
  const auth = useAuth()

  // Смена статуса авторизации → перепроверить guard-ы маршрутов
  useEffect(() => {
    if (auth.status !== 'loading') void router.invalidate()
  }, [auth.status])

  // Другой пользователь в том же браузере не должен видеть закэшированные данные предыдущего
  const userId = auth.session?.user.id ?? null
  const lastUserId = useRef(userId)
  useEffect(() => {
    if (lastUserId.current !== userId) {
      queryClient.clear()
      lastUserId.current = userId
    }
  }, [userId])

  useEffect(() => {
    if (userId && auth.status === 'ready') void syncLanguageWithProfile(userId)
  }, [userId, auth.status])

  if (auth.status === 'loading') return null
  return <RouterProvider router={router} context={{ auth, queryClient }} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
