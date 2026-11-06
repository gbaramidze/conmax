import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { setWatching, watchQuery } from '@/features/notifications/api'

/** «Следить» / «Вы следите»: подписка на изменения и комментарии объекта. */
export function WatchButton({ entity }: { entity: { type: string; id: string } }) {
  const { session } = useAuth()
  const uid = session!.user.id
  const queryClient = useQueryClient()
  const { data: row, isLoading } = useQuery(watchQuery(entity, uid))
  const watching = !!row && !row.muted

  const toggle = useMutation({
    mutationFn: () => setWatching(entity, uid, !watching, !!row),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watch', entity.type, entity.id] }),
    onError: () => toast.error(tr('Не удалось изменить подписку. Попробуйте ещё раз.')),
  })

  return (
    <Button
      size="sm"
      variant={watching ? 'secondary' : 'outline'}
      aria-pressed={watching}
      disabled={isLoading || toggle.isPending}
      title={watching ? tr('Нажмите, чтобы перестать следить') : tr('Получать уведомления об изменениях и комментариях')}
      onClick={() => toggle.mutate()}
    >
      {watching ? <BellRing /> : <Bell />} {watching ? tr('Вы следите') : tr('Следить')}
    </Button>
  )
}
