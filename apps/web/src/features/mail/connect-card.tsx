import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Inbox, Mail, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { myTenantPermissionsQuery } from '@/features/people/org-api'
import { mailAccountQuery, mailAuthUrl, mailDisconnect, mailErrorText } from '@/features/mail/api'

/** Строка «Outlook» в разделе «Подключения» профиля: подключить, открыть почту, отключить. */
export function OutlookConnection() {
  const queryClient = useQueryClient()
  const { data: perms } = useQuery(myTenantPermissionsQuery)
  const { data: account, isPending } = useQuery(mailAccountQuery)
  const allowed = perms?.includes('mail.connect') ?? false

  const connect = useMutation({
    mutationFn: mailAuthUrl,
    onSuccess: (url) => {
      window.location.assign(url)
    },
    onError: (e) => toast.error(mailErrorText(e)),
  })
  const disconnect = useMutation({
    mutationFn: mailDisconnect,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mail'] })
      toast.success(tr('Почта отключена. Письма в Outlook остались на месте.'))
    },
    onError: () => toast.error(tr('Не удалось отключить почту. Попробуйте ещё раз.')),
  })

  const needsReconnect = !!account?.last_error

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{tr('Outlook')}</span>
          {account ? (
            <span className="block text-sm text-muted-foreground">
              <span className="break-all font-medium text-foreground">{account.email}</span>
              {' · '}
              {tr('подключена {{date}}', { date: new Date(account.connected_at).toLocaleDateString(currentLocale(), { dateStyle: 'medium' }) })}
            </span>
          ) : (
            <span className="block text-sm text-muted-foreground">
              {tr('Ваши письма из рабочего Outlook (Microsoft 365) прямо в BuildOS: читать, отмечать прочитанными и удалять. Отправки нет. Видите их только вы.')}
            </span>
          )}
        </span>
        {account && !needsReconnect && (
          <Badge variant="secondary" className="shrink-0">
            <CheckCircle2 />
            {tr('Подключена')}
          </Badge>
        )}
      </div>

      {needsReconnect && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{account?.last_error}</p>
        </div>
      )}

      {!isPending && !allowed && !account && <p className="text-sm text-muted-foreground">{tr('Подключение почты вам недоступно. Администратор может выдать право в разделе «Роли и права».')}</p>}

      <div className="flex flex-wrap gap-2">
        {account && (
          <Button asChild size="sm" variant="secondary">
            <Link to="/mail" search={{}}>
              <Inbox />
              {tr('Открыть почту')}
            </Link>
          </Button>
        )}
        {allowed && (!account || needsReconnect) && (
          <Button type="button" size="sm" disabled={connect.isPending} onClick={() => connect.mutate()}>
            <Mail />
            {connect.isPending ? tr('Открываем Microsoft…') : needsReconnect ? tr('Подключить заново') : tr('Подключить Outlook')}
          </Button>
        )}
        {account && (
          <Button type="button" size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
            <Unplug />
            {tr('Отключить')}
          </Button>
        )}
      </div>
    </div>
  )
}
