import { tr } from '@/lib/tr'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import type { RouterContext } from '@/router'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  errorComponent: ({ reset }) => (
    <main className="flex min-h-svh items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-start gap-3">
        <h1 className="text-lg font-semibold">{tr('Не удалось загрузить страницу')}</h1>
        <p className="text-sm text-muted-foreground">{tr('Проверьте соединение и попробуйте снова. Если ошибка повторяется, выйдите и войдите заново.')}</p>
        <div className="flex gap-2">
          <Button onClick={reset}>{tr('Повторить')}</Button>
          <Button
            variant="outline"
            onClick={() => {
              // местный выход: сессия могла стать недействительной
              void supabase.auth.signOut({ scope: 'local' }).then(() => window.location.assign('/login'))
            }}
          >{tr('Выйти')}</Button>
        </div>
      </div>
    </main>
  ),
})
