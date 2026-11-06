import { Bell, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

export interface PopupNotification {
  id: string
  title: string
  body: string | null
  priority: string
}

/**
 * Всплывающее уведомление сверху: висит, пока человек не нажмёт «Открыть» или «Закрыть» (само не пропадает), поэтому его не пропустить.
 * Повторное уведомление по тому же объекту заменяет это же окно, а не складывает стопку. Высокая важность выделена цветом полосы.
 */
export function showNotificationPopup(n: PopupNotification, handlers: { onOpen: () => void }): void {
  toast.custom(
    (id) => (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(
          'flex w-full min-w-0 flex-col gap-3 rounded-xl border border-l-[5px] bg-popover p-4 text-popover-foreground shadow-xl',
          n.priority === 'critical' ? 'border-l-red-600' : n.priority === 'high' ? 'border-l-signal' : 'border-l-border',
        )}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-primary/15">
            <Bell className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[15px] font-semibold leading-snug">{n.title}</p>
            {n.body && <p className="mt-1 break-words text-sm text-muted-foreground">{n.body}</p>}
          </div>
          <button
            type="button"
            aria-label={tr('Закрыть уведомление')}
            onClick={() => toast.dismiss(id)}
            className="-mr-1 -mt-1 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            className="h-11 flex-1"
            onClick={() => {
              toast.dismiss(id)
              handlers.onOpen()
            }}
          >
            {tr('Открыть')}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => toast.dismiss(id)}>
            {tr('Закрыть')}
          </Button>
        </div>
      </div>
    ),
    { id: n.id, duration: Infinity, position: 'top-center', dismissible: false },
  )
}
