import { createRouter } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { AuthState } from '@/features/auth/auth-provider'
import { routeTree } from './routeTree.gen'

export interface RouterContext {
  auth: AuthState
  queryClient: QueryClient
}

export const router = createRouter({
  routeTree,
  context: {} as RouterContext,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
