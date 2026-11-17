import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, Check, HardHat, ListPlus, Lock, MapPin, RotateCcw, User, UserPen } from 'lucide-react'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { activityLoader } from '@/features/activity/loader'
import { AttachmentThumb } from '@/features/activity/attachment-thumb'
import { meQuery } from '@/features/auth/api'
import { UserAvatar } from '@/features/profile/avatar'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { AddresseePicker } from '@/features/notes/addressee-picker'
import { SchemePanZoom } from '@/features/inspections/scheme-pan-zoom'
import { SchemeView } from '@/features/inspections/scheme-view'
import { addresseeIds, addresseeReady, noteAddresseeName, notePhotos, noteQuery, noteScheme, setNoteAddressee, setNoteStatus, type Addressee } from '@/features/notes/api'
import { NoteToTaskDialog } from '@/features/notes/to-task-dialog'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { cn } from '@/lib/utils'

// Карточка заметки с площадки: что и где, фото, кому адресована, обсуждение, создание задачи
export const Route = createFileRoute('/_app/projects/$code/note/$id')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const note = await queryClient.ensureQueryData(noteQuery(project.id, params.id))
    if (!note) throw notFound()
    await Promise.all([
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
      queryClient.ensureQueryData(meQuery),
      activityLoader(queryClient, { type: 'field_note', id: params.id }),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем заметку…')}</p>,
  notFoundComponent: () => {
    const { code } = Route.useParams()
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6">
        <p className="font-medium">{tr('Заметка не найдена')}</p>
        <p className="text-sm text-muted-foreground">{tr('Возможно, её удалили или у вас нет к ней доступа.')}</p>
        <Link to="/projects/$code/notes" params={{ code }} search={{ filter: 'open', org: 'any', who: 'any', author: 'any', location: 'any', period: 'all', from: '', to: '', photo: false }} className="text-sm font-medium underline underline-offset-4">
          {tr('К списку заметок')}
        </Link>
      </div>
    )
  },
  component: NotePage,
})

const dateFmt = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })

/** Смена адресата: автору и руководителю. */
function AddresseeDialog({ commentId, projectId, initial, onClose }: { commentId: string; projectId: string; initial: Addressee; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState<Addressee>(initial)
  const save = useMutation({
    mutationFn: () => {
      const to = addresseeIds(value)
      return setNoteAddressee(commentId, to.user, to.org)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
      toast.success(tr('Адресат изменён'))
      onClose()
    },
    onError: () => toast.error(tr('Не удалось сменить адресата. Внутреннюю заметку нельзя адресовать тому, кто не видит внутреннее.')),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Кому адресована заметка')}</DialogTitle>
          <DialogDescription>{tr('Новый адресат получит уведомление.')}</DialogDescription>
        </DialogHeader>
        <AddresseePicker projectId={projectId} value={value} onChange={setValue} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={!addresseeReady(value) || save.isPending} onClick={() => save.mutate()}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NotePage() {
  const { code, id } = Route.useParams()
  const queryClient = useQueryClient()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: note } = useSuspenseQuery(noteQuery(p.id, id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: me } = useSuspenseQuery(meQuery)
  const { data: locations = [] } = useQuery(locationsQuery(p.id))
  const [taskOpen, setTaskOpen] = useState(false)
  const [addresseeOpen, setAddresseeOpen] = useState(false)
  const [schemeOpen, setSchemeOpen] = useState(false)

  const n = note!
  const loc = locations.find((l) => l.id === n.location_id)
  const photos = notePhotos(n)
  const scheme = noteScheme(n)
  const addressee = noteAddresseeName(n)
  const done = n.status === 'done'
  const isAuthor = n.author_id === me.id
  const canModerate = permissions.includes('comment.delete.any')
  const canToggle = canModerate || isAuthor || n.addressee_user_id === me.id || (!!n.addressee_org_id && n.addressee_org_id === me.organization_id)
  const canChangeAddressee = canModerate || isAuthor
  const canCreateTask = permissions.includes('task.create') && !n.task_id

  const toggle = useMutation({
    mutationFn: () => setNoteStatus(n.comment_id, !done),
    onSuccess: async () => {
      toast.success(done ? tr('Заметка снова в работе') : tr('Заметка закрыта'))
      await queryClient.invalidateQueries({ queryKey: ['notes', p.id] })
    },
    onError: () => toast.error(tr('Не удалось изменить заметку. Попробуйте ещё раз.')),
  })

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link
        to="/projects/$code/notes"
        params={{ code }}
        search={{ filter: 'open', org: 'any', who: 'any', author: 'any', location: 'any', period: 'all', from: '', to: '', photo: false }}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {tr('Все заметки')}
      </Link>

      <article className={cn('flex flex-col gap-4 rounded-lg border border-l-4 bg-card p-4 shadow-soft sm:p-5', done ? 'border-l-green-500/70 bg-muted/30' : 'border-l-signal')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {loc && locationLabel(loc.path, locations).includes(' › ') && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{locationLabel(loc.path, locations).split(' › ').slice(0, -1).join(' › ')}</span>
              </p>
            )}
            <h1 className="text-xl font-semibold leading-snug tracking-tight">
              {loc ? (
                <Link to="/projects/$code/locations/$path" params={{ code, path: loc.path }} className="underline-offset-4 hover:underline">
                  {locationLabel(loc.path, locations).split(' › ').pop()}
                </Link>
              ) : (
                tr('Заметка')
              )}
            </h1>
          </div>
          <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', done ? 'bg-green-500/10 text-green-800 dark:text-green-300' : 'bg-muted text-foreground')}>
            <span aria-hidden className={cn('size-1.5 rounded-full', done ? 'bg-green-600' : 'bg-signal ring-1 ring-black/20')} />
            {done ? tr('Закрыта') : tr('Открыта')}
          </span>
        </div>

        {n.comment?.body_text && <p className="whitespace-pre-line break-words text-base leading-relaxed">{n.comment.body_text}</p>}

        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((f) => (
              <li key={f.id}>
                <AttachmentThumb file={f} group={photos} />
              </li>
            ))}
          </ul>
        )}

        {scheme && n.scheme_x !== null && n.scheme_y !== null && (
          <div className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              {tr('Точка на схеме')}
            </p>
            <SchemeView source={scheme} alt={tr('Схема места')} markers={[]} draft={{ x: Number(n.scheme_x), y: Number(n.scheme_y) }} onOpen={() => setSchemeOpen(true)} maxHeightClass="max-h-72" />
          </div>
        )}

        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 border-t pt-4 text-sm">
          <dt className="text-muted-foreground">{tr('Автор')}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <UserAvatar name={n.author?.full_name ?? '?'} className="size-6 text-[10px]" />
            <span className="font-medium">{n.author?.full_name ?? '—'}</span>
            <time dateTime={n.created_at} className="text-muted-foreground">{dateFmt.format(new Date(n.created_at))}</time>
          </dd>
          <dt className="text-muted-foreground">{tr('Кому')}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            {addressee ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5">
                {n.org ? <HardHat className="size-3" aria-hidden /> : <User className="size-3" aria-hidden />}
                {addressee}
              </span>
            ) : (
              <span className="text-muted-foreground">{tr('Никому')}</span>
            )}
            {canChangeAddressee && (
              <button type="button" onClick={() => setAddresseeOpen(true)} className="inline-flex min-h-9 items-center gap-1 text-xs font-medium underline underline-offset-4">
                <UserPen className="size-3.5" aria-hidden />
                {tr('Сменить')}
              </button>
            )}
          </dd>
          {n.comment?.visibility === 'internal' && (
            <>
              <dt className="text-muted-foreground">{tr('Доступ')}</dt>
              <dd className="inline-flex items-center gap-1">
                <Lock className="size-3.5" aria-hidden />
                {tr('внутренняя, только свои')}
              </dd>
            </>
          )}
          {done && n.resolved_at && (
            <>
              <dt className="text-muted-foreground">{tr('Закрыта')}</dt>
              <dd>{dateFmt.format(new Date(n.resolved_at))}</dd>
            </>
          )}
          {n.task && (
            <>
              <dt className="text-muted-foreground">{tr('Задача')}</dt>
              <dd>
                <Link to="/projects/$code/task/$key" params={{ code, key: n.task.key }} className="ident font-medium underline underline-offset-4">
                  {n.task.key}
                </Link>
              </dd>
            </>
          )}
        </dl>

        {/* Что делать с заметкой, решают здесь: закрыть, обсудить в комментариях или завести задачу */}
        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:flex-wrap">
          {canCreateTask && (
            <Button size="lg" onClick={() => setTaskOpen(true)}>
              <ListPlus />
              {tr('Создать задачу')}
            </Button>
          )}
          {canToggle && (
            <Button size="lg" variant={done ? 'outline' : canCreateTask ? 'outline' : 'default'} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {done ? <RotateCcw /> : <Check />}
              {done ? tr('Вернуть в работу') : tr('Закрыть заметку')}
            </Button>
          )}
        </div>
      </article>

      <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем обсуждение…')}</p>}>
        <ActivityFeed entity={{ type: 'field_note', id }} projectId={p.id} title={tr('Обсуждение заметки')} />
      </Suspense>

      {schemeOpen && scheme && n.scheme_x !== null && n.scheme_y !== null && (
        <Dialog open onOpenChange={(o) => !o && setSchemeOpen(false)}>
          <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{tr('Точка на схеме')}</DialogTitle>
              <DialogDescription>{tr('Двумя пальцами увеличьте схему, одним сдвиньте.')}</DialogDescription>
            </DialogHeader>
            <SchemePanZoom source={scheme} alt={tr('Схема места')} markers={[]} draft={{ x: Number(n.scheme_x), y: Number(n.scheme_y) }} heightClass="h-[68svh]" />
          </DialogContent>
        </Dialog>
      )}

      {taskOpen && <NoteToTaskDialog note={n} projectId={p.id} canAssign={permissions.includes('task.assign')} canInternal={permissions.includes('comment.internal.create')} onClose={() => setTaskOpen(false)} onCreated={() => undefined} />}
      {addresseeOpen && <AddresseeDialog commentId={n.comment_id} projectId={p.id} initial={{ user: n.addressee_user_id, org: n.addressee_org_id }} onClose={() => setAddresseeOpen(false)} />}
    </div>
  )
}
