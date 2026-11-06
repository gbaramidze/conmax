import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ExportButton } from '@/features/export/export-button'
import { isoToDate } from '@/features/export/xlsx'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import {
  checksQuery,
  VERDICT_TEXT,
  formatQty,
  organizationsListQuery,
  RESOLUTION_TEXT,
  resolveDiscrepancy,
  WALK_ERROR_TEXT,
  WalkError,
  type CheckRow,
} from '@/features/volumes/api'
import { VerdictBadge } from '@/features/volumes/badges'

// Паттерн «Список / Index»: открытые расхождения с решением и история проверок
export const Route = createFileRoute('/_app/projects/$code/checks')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([queryClient.ensureQueryData(checksQuery(project.id)), queryClient.ensureQueryData(organizationsListQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем проверки…')}</p>,
  component: ChecksPage,
})

const dateTime = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Delta({ c }: { c: CheckRow }) {
  const sign = c.delta > 0 ? '+' : c.delta < 0 ? '−' : ''
  return (
    <span className="tabular-nums">{tr('заявлено')}{' '}<strong>{formatQty(c.reported_qty)}</strong>{tr('→ на месте')}{' '}<strong>{formatQty(c.observed_qty)}</strong> {c.item?.unit}{' '}
      <span className="text-muted-foreground">({c.delta === 0 ? '0' : `${sign}${formatQty(Math.abs(c.delta))}`})</span>
    </span>
  )
}

function ChecksPage() {
  const { code } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: checks } = useSuspenseQuery(checksQuery(p.id))
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canResolve = permissions.includes('walk.approve')
  const canVerify = permissions.includes('walk.verify')
  const [resolving, setResolving] = useState<{ check: CheckRow; kind: 'accept_reported' | 'accept_observed' } | null>(null)

  const orgName = new Map(orgs.map((o) => [o.id, o.name]))
  const open = checks.filter((c) => c.verdict !== 'match' && c.resolution === null)
  const history = checks.filter((c) => !(c.verdict !== 'match' && c.resolution === null))
  const matched = checks.filter((c) => c.verdict === 'match').length

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{tr('Независимые проверки сверяют заявленный факт с тем, что есть на месте. Совпадения принимаются автоматически, расхождения ждут решения.')}</p>
        <div className="flex flex-wrap gap-2">
          <ExportButton
            fileName={tr('Проверки {{code}}', { code: p.code })}
            disabled={checks.length === 0}
            build={() => ({
              name: tr('Проверки'),
              headers: [tr('Дата'), tr('Работа'), tr('Место'), tr('Подрядчик'), tr('Ед.'), tr('Заявлено'), tr('На месте'), tr('Разница'), tr('Вердикт'), tr('Независимая'), tr('Проверил'), tr('Решение'), tr('Решил'), tr('Комментарий')],
              rows: checks.map((c) => [
                isoToDate(c.checked_at),
                c.item?.name ?? '',
                c.item?.location_path ?? '',
                orgName.get(c.item?.contractor_org_id ?? '') ?? '',
                c.item?.unit ?? '',
                c.reported_qty,
                c.observed_qty,
                c.delta,
                VERDICT_TEXT[c.verdict],
                c.independent ? tr('да') : tr('нет'),
                c.checker?.full_name ?? '',
                c.resolution ? RESOLUTION_TEXT[c.resolution] : c.verdict === 'match' ? '' : tr('открыто'),
                c.resolver?.full_name ?? '',
                c.resolution_note ?? '',
              ]),
            })}
          />
          {canVerify && (
            <Button asChild>
              <Link to="/projects/$code/walk" params={{ code }} search={{ kind: 'check' }}>
                <ShieldCheck />{tr('Провести проверку')}</Link>
            </Button>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-label={tr('Открытые расхождения')}>
        <h2 className="text-base font-semibold">{tr('Открытые расхождения:')}{' '}{open.length}</h2>
        {open.length === 0 ? (
          <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground shadow-soft">
            {checks.length === 0
              ? tr('Проверок ещё не было. Проведите первую: выберите этаж и укажите, сколько на самом деле сделано.')
              : tr('Открытых расхождений нет. Всё, что проверялось, сошлось или уже разобрано.')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.item?.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="ident mr-2">{c.item?.location_path}</span>
                      {orgName.get(c.item?.contractor_org_id ?? '') ?? tr('Без подрядчика')}
                    </p>
                  </div>
                  <VerdictBadge verdict={c.verdict} />
                </div>
                <p className="text-sm">
                  <Delta c={c} />
                </p>
                <p className="text-xs text-muted-foreground">{tr('Проверил')}{' '}{c.checker?.full_name ?? '—'}, {dateTime.format(new Date(c.checked_at))}
                  {!c.independent && tr(' · проверка не независимая: проверяющий сам вносил факт по этой позиции')}
                </p>
                {canResolve && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" onClick={() => setResolving({ check: c, kind: 'accept_observed' })}>{tr('Принять проверенное')}</Button>
                    <Button variant="outline" onClick={() => setResolving({ check: c, kind: 'accept_reported' })}>{tr('Принять заявленное')}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label={tr('История проверок')}>
        <h2 className="text-base font-semibold">{tr('История')}{' '}<span className="font-normal text-muted-foreground">{tr('· совпало')}{' '}{matched}{tr('из')}{' '}{checks.length}</span>
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr('Пока пусто.')}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border bg-card shadow-soft">
            {history.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium">
                    {c.item?.name} <span className="ident ml-1 text-muted-foreground">{c.item?.location_path}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {c.resolution && <span className="text-xs text-muted-foreground">{RESOLUTION_TEXT[c.resolution]}</span>}
                    <VerdictBadge verdict={c.verdict} />
                  </span>
                </div>
                <p className="text-sm">
                  <Delta c={c} />
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.checker?.full_name ?? '—'}, {dateTime.format(new Date(c.checked_at))}
                  {c.resolver && tr(' · решил {{full_name}}', { full_name: c.resolver.full_name })}
                  {c.resolution_note && ` · «${c.resolution_note}»`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolving && <ResolveDialog {...resolving} onClose={() => setResolving(null)} />}
    </div>
  )
}

function ResolveDialog({
  check,
  kind,
  onClose,
}: {
  check: CheckRow
  kind: 'accept_reported' | 'accept_observed'
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const observed = kind === 'accept_observed'

  const resolve = useMutation({
    mutationFn: () => resolveDiscrepancy(check.id, kind, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['checks'] }),
        queryClient.invalidateQueries({ queryKey: ['work-items'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ])
      toast.success(observed ? tr('Принят проверенный итог, факт скорректирован') : tr('Принято заявленное'))
      onClose()
    },
    onError: (e) => toast.error(e instanceof WalkError ? (WALK_ERROR_TEXT[e.code] ?? tr('Не удалось сохранить решение.')) : tr('Не удалось сохранить решение.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{observed ? tr('Принять проверенный итог') : tr('Принять заявленное')}</DialogTitle>
          <DialogDescription>
            {check.item?.name}, <span className="ident">{check.item?.location_path}</span>{tr(': заявлено')}{' '}{formatQty(check.reported_qty)}{tr(', на месте')}{' '}
            {formatQty(check.observed_qty)} {check.item?.unit}.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {observed
            ? tr('Факт позиции станет равен проверенному: добавится корректировка {{v1}}{{v2}} {{unit}}. История сохранится.', { v1: check.delta > 0 ? '+' : '−', v2: formatQty(Math.abs(check.delta)), unit: check.item?.unit })
            : tr('Факт не изменится, позиция будет отмечена «принято решением». Объясните, почему заявленному можно верить.')}
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="resolve-note">{tr('Комментарий')}{observed ? tr(' (необязательно)') : ''}</Label>
          <Textarea id="resolve-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="text-base md:text-sm" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={resolve.isPending || (!observed && !note.trim())} onClick={() => resolve.mutate()}>
            {observed ? tr('Принять проверенное') : tr('Принять заявленное')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
