import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { peopleDirectoryQuery } from '@/features/people/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

async function readErrorCode(error: unknown): Promise<string | null> {
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null)
    return body?.error ?? null
  }
  return null
}

const ERROR_TEXT: Record<string, string> = {
  already_accepted: tr('Человек уже принял приглашение.'),
  forbidden: tr('У вас нет права отправлять приглашения.'),
  rate_limited: tr('Слишком много писем за короткое время. Попробуйте через несколько минут.'),
  email_send_failed: tr('Не удалось отправить письмо: почта на сервере не настроена. Обратитесь к администратору.'),
}

/** Повторная отправка приглашения тому, кто ещё не принял прежнее (письмо не дошло или потерялось). */
export function ResendInviteButton({
  userId,
  name,
  projectId,
  className,
  children,
}: {
  userId: string
  name: string
  /** Нужен, когда приглашает менеджер проекта, а не администратор компании */
  projectId?: string
  className?: string
  children?: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const resend = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { resend: true, user_id: userId, project_id: projectId ?? null, redirect_to: window.location.origin },
      })
      if (error) throw new Error((await readErrorCode(error)) ?? 'invite_failed')
      return (data as { email: string }).email
    },
    onSuccess: async (email) => {
      toast.success(tr('Приглашение отправлено ещё раз: {{email}}', { email }))
      await queryClient.invalidateQueries({ queryKey: peopleDirectoryQuery.queryKey })
    },
    onError: (e: Error) => toast.error(ERROR_TEXT[e.message] ?? tr('Не удалось отправить приглашение.')),
  })
  const label = tr('Отправить приглашение ещё раз: {{name}}', { name })
  return (
    <button
      type="button"
      disabled={resend.isPending}
      onClick={() => resend.mutate()}
      aria-label={label}
      title={tr('Отправить приглашение ещё раз')}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        children ? 'min-h-9 px-2 text-xs' : 'size-10',
        className,
      )}
    >
      <Send className="size-4" />
      {children}
    </button>
  )
}
