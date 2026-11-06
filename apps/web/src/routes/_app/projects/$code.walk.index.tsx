import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Footprints, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-provider'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker, readRecentLocations } from '@/features/locations/location-picker'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { myDraftWalksQuery, startWalk, WALK_ERROR_TEXT, WalkError, type WalkKind } from '@/features/volumes/api'

// Паттерн «Форма»: выбрать вид обхода и место, начать
export const Route = createFileRoute('/_app/projects/$code/walk/')({
  validateSearch: z.object({ kind: z.enum(['report', 'check']).optional() }),
  loader: async ({ context: { queryClient, auth }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myDraftWalksQuery(auth.session!.user.id, project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>,
  component: WalkStartPage,
})

function WalkStartPage() {
  const { code } = Route.useParams()
  const { kind: kindParam } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: drafts } = useQuery(myDraftWalksQuery(session!.user.id, p.id))
  const [location, setLocation] = useState<string | null>(() => readRecentLocations(p.id)[0] ?? null)
  const canReport = permissions.includes('walk.create')
  const canCheck = permissions.includes('walk.verify')
  const [kindChoice, setKind] = useState<WalkKind>(kindParam ?? (canReport ? 'report' : 'check'))
  const kind: WalkKind = kindChoice === 'check' && canCheck ? 'check' : canReport ? 'report' : 'check'

  const start = useMutation({
    mutationFn: () => startWalk(p.id, location!, kind),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['walks', 'drafts'] })
      await navigate({ to: '/projects/$code/walk/$id', params: { code, id } })
    },
    onError: (e) => toast.error(e instanceof WalkError ? (WALK_ERROR_TEXT[e.code] ?? tr('Не удалось начать обход.')) : tr('Не удалось начать обход.')),
  })

  if (!canReport && !canCheck) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{tr('У вашей роли нет права проводить обходы.')}</p>
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{kind === 'check' ? tr('Проверка') : tr('Обход')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {kind === 'check'
            ? tr('Выберите этаж или помещение и укажите, сколько на самом деле сделано. Заявленное откроется после ввода — так проверка остаётся независимой.')
            : tr('Выберите этаж или помещение — система покажет, что здесь должно быть сделано. Отметьте факт по каждой позиции и завершите обход.')}
        </p>
      </div>

      {canReport && canCheck && (
        <div role="group" aria-label={tr('Вид обхода')} className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1">
          {(
            [
              ['report', tr('Внести факт')],
              ['check', tr('Проверить факт')],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                kind === k ? 'bg-card font-medium shadow-soft' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(drafts?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2" aria-label={tr('Незавершённые обходы')}>
          <h3 className="text-sm font-semibold">{tr('Продолжить')}</h3>
          <ul className="overflow-hidden rounded-lg border bg-card shadow-soft">
            {drafts!.map((d) => (
              <li key={d.id} className="border-b last:border-b-0">
                <Link to="/projects/$code/walk/$id" params={{ code, id: d.id }} className="flex min-h-14 items-center gap-3 px-4 hover:bg-muted/50">
                  <span className="ident text-muted-foreground">{d.location_path}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{locationLabel(d.location_path, locations)}</span>
                  {d.kind === 'check' && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tr('проверка')}</span>}
                  <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={kind === 'check' ? tr('Новая проверка') : tr('Новый обход')}>
        <h3 className="text-sm font-semibold">{kind === 'check' ? tr('Новая проверка') : tr('Новый обход')}</h3>
        <LocationPicker projectId={p.id} value={location} onChange={setLocation} placeholder={tr('Где вы сейчас?')} />
        <Button size="lg" disabled={!location || start.isPending} onClick={() => start.mutate()}>
          {kind === 'check' ? <ShieldCheck /> : <Footprints />}{' '}
          {start.isPending ? tr('Открываем…') : kind === 'check' ? tr('Начать проверку') : tr('Начать обход')}
        </Button>
        {!location && <p className="text-center text-xs text-muted-foreground">{tr('Сначала выберите место.')}</p>}
      </section>
    </div>
  )
}
