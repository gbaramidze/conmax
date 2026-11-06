import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { BellRing, CheckCircle2, ExternalLink, Eye, FileText, GitCompareArrows, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Suspense, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ActivityFeed } from '@/features/activity/activity-feed'
import { formatBytes, openFile } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import {
  acksQuery,
  ackVersion,
  addLink,
  DOC_ERROR_TEXT,
  DOC_TYPE_LABELS,
  documentOrgsQuery,
  documentQuery,
  DocumentError,
  fileTextStatusQuery,
  isViewableFile,
  linksQuery,
  nextRevision,
  publishVersion,
  removeLink,
  setOrgs,
  setVersionPreview,
  updateDocument,
  VERSION_STATUS_LABELS,
  versionsQuery,
  type DocType,
  type DocumentRow,
  type VersionRow,
} from '@/features/documents/api'
import { CompareVersionsDialog } from '@/features/documents/compare/compare-dialog'
import { DocumentText } from '@/features/documents/document-text'
import { NewVersionDialog } from '@/features/documents/upload-dialog'
import { locationLabel, locationsQuery, type LocationRow } from '@/features/locations/api'
import { FloorRangeButton } from '@/features/locations/floor-range'
import { LocationPicker } from '@/features/locations/location-picker'
import { officeKind } from '@/features/documents/office'
import { versionSource } from '@/features/plans/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { organizationsListQuery } from '@/features/volumes/api'
import { supabase } from '@/lib/supabase'

const dateTime = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_STYLE: Record<VersionRow['status'], string> = {
  published: 'bg-green-500/10 text-green-700 dark:text-green-300',
  superseded: 'bg-muted text-muted-foreground',
  draft: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
}

function errorText(e: unknown, fallback: string) {
  return e instanceof DocumentError ? (DOC_ERROR_TEXT[e.code] ?? fallback) : fallback
}

/** PDF для просмотра у версии, исходник которой (DWG и др.) на экране не открывается. */
function PreviewRow({
  version,
  projectId,
  canEdit,
  open,
  onChanged,
}: {
  version: VersionRow
  projectId: string
  canEdit: boolean
  open: (key: string | undefined) => void
  onChanged: () => Promise<unknown>
}) {
  const { tenantId } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const set = useMutation({
    mutationFn: (file: File | null) => setVersionPreview({ versionId: version.id, projectId, tenantId: tenantId!, file }),
    onSuccess: async (_, file) => {
      await onChanged()
      toast.success(file ? tr('PDF для просмотра сохранён') : tr('PDF для просмотра убран'))
    },
    onError: (e) => toast.error(errorText(e, tr('Не удалось сохранить PDF. Попробуйте ещё раз.'))),
  })
  const preview = version.preview

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (input.current) input.current.value = ''
          if (f) set.mutate(f)
        }}
      />
      {preview ? (
        <>
          <span className="font-medium">{tr('Просмотр на плане:')}</span>
          <button type="button" className="underline underline-offset-2" onClick={() => open(preview.storage_key)}>
            {preview.name}
          </button>
          {canEdit && (
            <>
              <button type="button" disabled={set.isPending} className="text-muted-foreground underline underline-offset-2" onClick={() => input.current?.click()}>{tr('заменить')}</button>
              <button type="button" disabled={set.isPending} className="text-muted-foreground underline underline-offset-2" onClick={() => set.mutate(null)}>{tr('убрать')}</button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-muted-foreground">{tr('Этот формат на экране не открывается, поэтому на плане его не показать.')}</span>
          {canEdit && (
            <button type="button" disabled={set.isPending} className="font-medium underline underline-offset-2" onClick={() => input.current?.click()}>
              {set.isPending ? tr('Загружаем…') : tr('Добавить PDF для просмотра')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Всё о документе: статус, версии, привязки, ознакомление, обсуждение. Показывается в боковой панели просмотрщика. */
export function DocumentDetails({ code, id, q }: { code: string; id: string; q?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: doc } = useSuspenseQuery(documentQuery(id))
  const d = doc!
  const { data: versions } = useSuspenseQuery(versionsQuery(id))
  const { data: links } = useSuspenseQuery(linksQuery(id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: disciplineRows } = useQuery(disciplinesQuery(p.id))

  const uid = session!.user.id
  const canPublish = permissions.includes('document.publish')
  const canEdit = d.created_by === uid || canPublish
  const canUpload = permissions.includes('document.upload') && canEdit
  const discipline = disciplineRows?.find((x) => x.id === d.discipline_id)
  const current = versions.find((v) => v.id === d.current_version_id)
  const [newVersion, setNewVersion] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['document', id] }),
      queryClient.invalidateQueries({ queryKey: ['document-versions', id] }),
      queryClient.invalidateQueries({ queryKey: ['document-links', id] }),
      queryClient.invalidateQueries({ queryKey: ['document-acks'] }),
      queryClient.invalidateQueries({ queryKey: ['entity-documents'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ])

  const publish = useMutation({
    mutationFn: (versionId: string) => publishVersion(versionId),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Версия выпущена, команда уведомлена'))
    },
    onError: (e) => toast.error(errorText(e, tr('Не удалось выпустить версию.'))),
  })
  const ack = useMutation({
    mutationFn: (versionId: string) => ackVersion(versionId),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Отмечено: вы ознакомлены'))
    },
    onError: (e) => toast.error(errorText(e, tr('Не удалось сохранить отметку.'))),
  })
  const remove = useMutation({
    mutationFn: () => updateDocument(d.id, { deleted_at: new Date().toISOString() }),
    onSuccess: async () => {
      await refresh()
      toast.success(tr('Документ удалён'))
      await navigate({ to: '/projects/$code/documents', params: { code }, search: {} })
    },
    onError: (e) => toast.error(errorText(e, tr('Не удалось удалить документ.'))),
  })

  const viewable = (v: VersionRow) => versionSource(v) !== null || (!!v.file && officeKind(v.file.name, v.file.mime) !== null)
  const open = (key: string | undefined) => key && openFile(key).catch(() => toast.error(tr('Не удалось открыть файл. Попробуйте ещё раз.')))

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" aria-hidden />
              {d.code && <span className="ident">{d.code}</span>}
              <span>· {DOC_TYPE_LABELS[d.doc_type]}</span>
              {discipline && <span className="ident rounded bg-muted px-1.5 py-0.5 text-xs">{discipline.code}</span>}
              {d.visibility === 'external' && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{tr('видно подрядчикам и заказчику')}</span>}
            </div>
            <h2 className="text-base font-semibold leading-snug">{d.title}</h2>
          </div>
          {canEdit && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil />{tr('Изменить')}</Button>
              {confirmDelete ? (
                <>
                  <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{tr('Удалить')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{tr('Нет')}</Button>
                </>
              ) : (
                <Button size="icon" variant="ghost" className="md:size-8" aria-label={tr('Удалить документ')} title={tr('Удалить документ')} onClick={() => setConfirmDelete(true)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          )}
        </div>

        {current ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{tr('Действует ревизия')}{' '}<span className="ident">{current.revision || `№${current.version_no}`}</span>
                {current.published_at && <span className="font-normal text-muted-foreground">{tr('· с')}{' '}{dateTime.format(new Date(current.published_at))}</span>}
              </p>
              {current.file && (
                <p className="truncate text-xs text-muted-foreground">
                  {current.file.name} · {formatBytes(current.file.size_bytes)}
                </p>
              )}
              {current.file && <TextStatusNote fileId={current.file.id} />}
              {current.note && <p className="mt-1 text-sm">{current.note}</p>}
            </div>
            {!viewable(current) && (
              <Button onClick={() => open(current.file?.storage_key)}>
                <ExternalLink />{tr('Скачать')}</Button>
            )}
          </div>
        ) : (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{tr('Документ ещё не выпущен: пока его видят только автор и выпускающие.')}{canPublish ? tr(' Выпустите версию ниже.') : ''}
          </p>
        )}

        {d.ack_pending && current && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <BellRing className="size-4 text-amber-800 dark:text-amber-300" aria-hidden />
            <p className="min-w-0 flex-1 text-sm font-medium">{tr('Прочитайте документ и подтвердите, что ознакомлены.')}</p>
            <Button disabled={ack.isPending} onClick={() => ack.mutate(current.id)}>
              <CheckCircle2 />{tr('Ознакомлен')}</Button>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="flex flex-col gap-2" aria-label={tr('Версии')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{tr('Версии ·')}{' '}{versions.length}</h2>
              <div className="flex gap-2">
                {versions.length >= 2 && (
                  <Button size="sm" variant="outline" onClick={() => setComparing(true)}>
                    <GitCompareArrows />{tr('Сравнить версии')}</Button>
                )}
                {canUpload && (
                  <Button size="sm" variant="outline" onClick={() => setNewVersion(true)}>
                    <Plus />{tr('Новая версия')}</Button>
                )}
              </div>
            </div>
            <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ident text-sm font-semibold">{v.revision || `№${v.version_no}`}</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[v.status]}`}>{VERSION_STATUS_LABELS[v.status]}</span>
                    <span className="text-xs text-muted-foreground">
                      {v.creator?.full_name ?? '—'}, {dateTime.format(new Date(v.created_at))}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {v.status === 'draft' && canPublish && (
                        <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate(v.id)}>{tr('Выпустить')}</Button>
                      )}
                      {viewable(v) ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/projects/$code/plan/$id" params={{ code, id }} search={{ version: v.id }}>
                            <Eye />{tr('Смотреть')}</Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => open(v.file?.storage_key)}>
                          <ExternalLink />{tr('Открыть')}</Button>
                      )}
                    </span>
                  </div>
                  {v.note && <p className="text-sm">{v.note}</p>}
                  {v.file && (
                    <p className="text-xs text-muted-foreground">
                      {v.file.name} · {formatBytes(v.file.size_bytes)}
                    </p>
                  )}
                  {v.file && !isViewableFile(v.file.name, v.file.mime) && (
                    <PreviewRow version={v} projectId={p.id} canEdit={canUpload} open={open} onChanged={refresh} />
                  )}
                </li>
              ))}
            </ul>
          </section>

          {current?.file && <DocumentText fileId={current.file.id} initialQuery={q ?? ''} />}

          {d.requires_ack && canEdit && current && <AckProgress versionId={current.id} />}

          <Suspense fallback={<p className="text-sm text-muted-foreground">{tr('Загружаем обсуждение…')}</p>}>
            <ActivityFeed entity={{ type: 'document', id: d.id }} projectId={p.id} title={tr('Обсуждение и история')} placeholder={tr('Вопрос по документу или замечание. @ — упомянуть коллегу')} />
          </Suspense>
        </div>

        <aside className="flex flex-col gap-5" aria-label={tr('Привязки')}>
          <LinksPanel doc={d} links={links} canEdit={canEdit} projectId={p.id} code={code} locationsRows={locations} onChanged={refresh} />
        </aside>
      </div>

      {newVersion && <NewVersionDialog documentId={d.id} projectId={p.id} nextRevisionHint={nextRevision(current?.revision ?? versions[0]?.revision)} onClose={() => setNewVersion(false)} />}
      {comparing && <CompareVersionsDialog code={code} versions={versions} currentId={d.current_version_id} onClose={() => setComparing(false)} />}
      {editing && <EditDialog doc={d} disciplineRows={disciplineRows ?? []} onClose={() => setEditing(false)} onSaved={refresh} />}
    </div>
  )
}

/** Читается ли содержимое файла: от этого зависит, найдётся ли документ поиском по тексту. */
function TextStatusNote({ fileId }: { fileId: string }) {
  const { data } = useQuery(fileTextStatusQuery(fileId))
  if (!data) return null
  const text =
    data.status === 'done'
      ? tr('Текст прочитан: документ находится поиском по содержимому.')
      : data.status === 'unsupported'
        ? tr('Содержимое не читается (чертёж или скан): ищите по названию и шифру. Для поиска по тексту загрузите PDF с текстовым слоем.')
        : data.status === 'failed'
          ? tr('Не удалось прочитать содержимое файла.')
          : tr('Читаем текст файла…')
  return <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
}

function AckProgress({ versionId }: { versionId: string }) {
  const { data: acks } = useQuery(acksQuery(versionId))
  if (!acks) return null
  const done = acks.filter((a) => a.acked_at).length
  return (
    <section className="flex flex-col gap-2" aria-label={tr('Ознакомление')}>
      <h2 className="text-base font-semibold">{tr('Ознакомление ·')}{' '}{done}{tr('из')}{' '}{acks.length}
      </h2>
      <div role="progressbar" aria-valuenow={acks.length ? Math.round((done / acks.length) * 100) : 0} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: acks.length ? `${(done / acks.length) * 100}%` : '0%' }} />
      </div>
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card text-sm">
        {acks.map((a) => (
          <li key={a.user_id} className="flex items-center justify-between gap-2 px-4 py-2">
            <span>{a.user?.full_name ?? tr('Участник')}</span>
            {a.acked_at ? (
              <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-300">
                <CheckCircle2 className="size-3.5" aria-hidden /> {dateTime.format(new Date(a.acked_at))}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{tr('ещё нет')}</span>
            )}
          </li>
        ))}
        {acks.length === 0 && <li className="px-4 py-2 text-muted-foreground">{tr('Получателей нет.')}</li>}
      </ul>
    </section>
  )
}

function LinksPanel({
  doc,
  links,
  canEdit,
  projectId,
  code,
  locationsRows,
  onChanged,
}: {
  doc: DocumentRow
  links: { id: string; entity_type: 'location' | 'task' | 'ffe_item' | 'room_type'; entity_id: string }[]
  canEdit: boolean
  projectId: string
  code: string
  locationsRows: LocationRow[]
  onChanged: () => Promise<unknown>
}) {
  const locLinks = links.filter((l) => l.entity_type === 'location')
  const taskIds = links.filter((l) => l.entity_type === 'task').map((l) => l.entity_id)
  const { data: tasks } = useQuery({
    queryKey: ['document-link-tasks', taskIds.join(',')],
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('id, key, title').in('id', taskIds)
      if (error) throw error
      return data
    },
  })

  const ffeIds = links.filter((l) => l.entity_type === 'ffe_item').map((l) => l.entity_id)
  const { data: ffeItems } = useQuery({
    queryKey: ['document-link-ffe', ffeIds.join(',')],
    enabled: ffeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('ffe_items').select('id, code, name').in('id', ffeIds)
      if (error) throw error
      return data
    },
  })

  const typeIds = links.filter((l) => l.entity_type === 'room_type').map((l) => l.entity_id)
  const { data: roomTypes } = useQuery({
    queryKey: ['document-link-room-types', typeIds.join(',')],
    enabled: typeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('room_types').select('id, name').in('id', typeIds)
      if (error) throw error
      return data
    },
  })

  const add = useMutation({
    mutationFn: (locationId: string) => addLink(doc.id, 'location', locationId),
    onSuccess: onChanged,
    onError: () => toast.error(tr('Не удалось привязать место.')),
  })
  const addMany = useMutation({
    mutationFn: async (ids: string[]) => {
      const already = new Set(locLinks.map((l) => l.entity_id))
      for (const id of ids) if (!already.has(id)) await addLink(doc.id, 'location', id)
    },
    onSuccess: onChanged,
    onError: () => toast.error(tr('Не удалось привязать место.')),
  })
  const drop = useMutation({
    mutationFn: (linkId: string) => removeLink(linkId),
    onSuccess: onChanged,
    onError: () => toast.error(tr('Не удалось убрать привязку.')),
  })

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('К чему относится')}>
      <h2 className="text-base font-semibold">{tr('К чему относится')}</h2>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">{tr('Места')}</h3>
        {locLinks.length === 0 && <p className="text-sm text-muted-foreground">{tr('Не привязан к месту.')}</p>}
        <ul className="flex flex-col gap-1">
          {locLinks.map((l) => {
            const loc = locationsRows.find((x) => x.id === l.entity_id)
            return (
              <li key={l.id} className="flex items-center gap-2 text-sm">
                {loc ? (
                  <Link to="/projects/$code/locations/$path" params={{ code, path: loc.path }} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                    <span className="ident shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{loc.path}</span>
                    <span className="truncate text-muted-foreground">{locationLabel(loc.path, locationsRows)}</span>
                  </Link>
                ) : (
                  <span className="flex-1 text-muted-foreground">{tr('место недоступно')}</span>
                )}
                {canEdit && (
                  <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать привязку')} onClick={() => drop.mutate(l.id)}>
                    <X />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        {canEdit && <LocationPicker projectId={projectId} value={null} placeholder={tr('Привязать к месту')} onChange={(id) => add.mutate(id)} />}
        {canEdit && <FloorRangeButton projectId={projectId} disabled={addMany.isPending} onPick={(ids) => addMany.mutate(ids)} />}
      </div>

      {taskIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{tr('Задачи')}</h3>
          <ul className="flex flex-col gap-1">
            {links
              .filter((l) => l.entity_type === 'task')
              .map((l) => {
                const t = tasks?.find((x) => x.id === l.entity_id)
                return (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    {t ? (
                      <Link to="/projects/$code/task/$key" params={{ code, key: t.key }} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                        <span className="ident shrink-0 text-xs text-muted-foreground">{t.key}</span>
                        <span className="truncate">{t.title}</span>
                      </Link>
                    ) : (
                      <span className="flex-1 text-muted-foreground">{tr('задача недоступна')}</span>
                    )}
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать привязку')} onClick={() => drop.mutate(l.id)}>
                        <X />
                      </Button>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      )}
      {typeIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{tr('Типы номеров')}</h3>
          <ul className="flex flex-col gap-1">
            {links
              .filter((l) => l.entity_type === 'room_type')
              .map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-sm">
                  <Link to="/projects/$code/ffe" params={{ code }} search={{ tab: 'types' }} className="min-w-0 flex-1 truncate hover:underline">
                    {roomTypes?.find((x) => x.id === l.entity_id)?.name ?? '…'}
                  </Link>
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать привязку')} onClick={() => drop.mutate(l.id)}>
                      <X />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
      {ffeIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">{tr('Мебель и оборудование')}</h3>
          <ul className="flex flex-col gap-1">
            {links
              .filter((l) => l.entity_type === 'ffe_item')
              .map((l) => {
                const it = ffeItems?.find((x) => x.id === l.entity_id)
                return (
                  <li key={l.id} className="flex items-center gap-2 text-sm">
                    <Link to="/projects/$code/ffe" params={{ code }} search={{ tab: 'catalog' }} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                      <span className="ident shrink-0 text-xs text-muted-foreground">{it?.code ?? '…'}</span>
                      <span className="truncate">{it?.name ?? ''}</span>
                    </Link>
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать привязку')} onClick={() => drop.mutate(l.id)}>
                        <X />
                      </Button>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tr('О новой версии уведомляются исполнители привязанных задач, участники и руководитель направления.')}</p>
    </section>
  )
}

const NONE = '__none__'

function EditDialog({
  doc,
  disciplineRows,
  onClose,
  onSaved,
}: {
  doc: DocumentRow
  disciplineRows: Parameters<typeof flattenDisciplines>[0]
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const { data: orgs } = useSuspenseQuery(organizationsListQuery)
  const { data: currentOrgs } = useSuspenseQuery(documentOrgsQuery(doc.id))
  const disciplines = useMemo(() => flattenDisciplines(disciplineRows), [disciplineRows])
  const externalOrgs = orgs.filter((o) => o.kind !== 'own')
  const [title, setTitle] = useState(doc.title)
  const [code, setCode] = useState(doc.code ?? '')
  const [docType, setDocType] = useState<DocType>(doc.doc_type)
  const [discipline, setDiscipline] = useState(doc.discipline_id ?? NONE)
  const [visibility, setVisibility] = useState(doc.visibility)
  const [requiresAck, setRequiresAck] = useState(doc.requires_ack)
  const [orgIds, setOrgIds] = useState<string[]>(currentOrgs)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async () => {
      await updateDocument(doc.id, {
        title: title.trim(),
        code: code.trim() || null,
        doc_type: docType,
        discipline_id: discipline === NONE ? null : discipline,
        visibility,
        requires_ack: requiresAck,
      })
      await setOrgs(doc.id, visibility === 'external' ? orgIds : [], currentOrgs)
    },
    onSuccess: async () => {
      await onSaved()
      toast.success(tr('Сохранено'))
      onClose()
    },
    onError: (e) => setError(errorText(e, tr('Не удалось сохранить.'))),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Изменить документ')}</DialogTitle>
          <DialogDescription>{tr('Файл меняется загрузкой новой версии.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-title">{tr('Название')}</Label>
            <Input id="e-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-code">{tr('Шифр')}</Label>
              <Input id="e-code" value={code} maxLength={80} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="e-type">{tr('Тип')}</Label>
              <Select value={docType} onValueChange={(v) => setDocType(v as DocType)}>
                <SelectTrigger id="e-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-disc">{tr('Направление')}</Label>
            <Select value={discipline} onValueChange={setDiscipline}>
              <SelectTrigger id="e-disc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>{tr('Без направления')}</SelectItem>
                {disciplines.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    <span style={{ paddingLeft: x.depth * 12 }}>
                      <span className="ident text-muted-foreground">{x.code}</span> {x.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{tr('Кому виден')}</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="evis" className="size-5 md:size-4" checked={visibility === 'internal'} onChange={() => setVisibility('internal')} />{tr('Только команде проекта')}</label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="evis" className="size-5 md:size-4" checked={visibility === 'external'} onChange={() => setVisibility('external')} />{tr('Команде, подрядчикам и заказчику')}</label>
            {visibility === 'external' && externalOrgs.length > 0 && (
              <div className="ml-8 flex flex-col gap-1 rounded-lg border p-2.5">
                <p className="text-xs text-muted-foreground">{tr('Не выбрано ни одной организации — открыт всем внешним участникам.')}</p>
                {externalOrgs.map((o) => (
                  <label key={o.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={orgIds.includes(o.id)}
                      onChange={(e) => setOrgIds((p) => (e.target.checked ? [...p, o.id] : p.filter((x) => x !== o.id)))}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 md:size-4" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />{tr('Требуется ознакомление при выпуске новых версий')}</label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={save.isPending || !title.trim()} onClick={() => save.mutate()}>{tr('Сохранить')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
