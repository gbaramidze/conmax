import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { AlertTriangle, CheckCircle2, CircleDashed, ShieldAlert, ShieldCheck } from 'lucide-react'
import { VERDICT_TEXT, type Verdict, type Verification } from '@/features/volumes/api'

const chip = 'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap'

/** Вердикт сверки: цвет всегда дублируется значком и словом. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'match') {
    return (
      <span className={`${chip} bg-green-500/10 text-green-700 dark:text-green-300`}>
        <CheckCircle2 className="size-3.5" aria-hidden /> {VERDICT_TEXT.match}
      </span>
    )
  }
  if (verdict === 'minor') {
    return (
      <span className={`${chip} bg-amber-500/15 text-amber-800 dark:text-amber-300`}>
        <AlertTriangle className="size-3.5" aria-hidden /> {VERDICT_TEXT.minor}
      </span>
    )
  }
  return (
    <span className={`${chip} bg-red-500/10 text-red-700 dark:text-red-300`}>
      <ShieldAlert className="size-3.5" aria-hidden /> {VERDICT_TEXT.major}
    </span>
  )
}

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short' })

/** Уровень доверия к заявленному факту позиции. Для позиций без факта не показывается. */
export function VerificationBadge({ verification, checkedAt, reported }: { verification: Verification; checkedAt: string | null; reported: boolean }) {
  if (!reported && verification === 'unchecked') return null
  const when = checkedAt ? ` · ${dateFmt.format(new Date(checkedAt))}` : ''
  switch (verification) {
    case 'verified':
      return (
        <span className={`${chip} bg-green-500/10 text-green-700 dark:text-green-300`}>
          <ShieldCheck className="size-3.5" aria-hidden />{tr('Проверено')}{when}
        </span>
      )
    case 'disputed':
      return (
        <span className={`${chip} bg-red-500/10 text-red-700 dark:text-red-300`}>
          <ShieldAlert className="size-3.5" aria-hidden />{tr('Спорная')}{when}
        </span>
      )
    case 'accepted':
      return (
        <span className={`${chip} bg-muted text-muted-foreground`}>
          <CheckCircle2 className="size-3.5" aria-hidden />{tr('Принято решением')}{when}
        </span>
      )
    default:
      return (
        <span className={`${chip} bg-muted text-muted-foreground`}>
          <CircleDashed className="size-3.5" aria-hidden />{tr('Не проверено')}</span>
      )
  }
}
