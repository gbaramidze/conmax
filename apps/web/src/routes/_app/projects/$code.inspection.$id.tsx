import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Building2, Camera, Check, FileDown, ImagePlus, ListTodo, Lock, MapPin, Pencil, Plus, Trash2, Undo2, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BackButton } from '@/components/app-shell/back-button'
import { SearchSelect, type SearchOption } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { signedUrlQuery } from '@/features/activity/api'
import { meQuery } from '@/features/auth/api'
import { useAuth } from '@/features/auth/auth-provider'
import {
  addPhotos,
  addSection,
  assignMany,
  resolveItem,
  assignItem,
  inspectionTasksQuery,
  type InspectionTask,
  clearSignature,
  deleteInspection,
  deleteItem,
  deletePhoto,
  deleteSection,
  INSPECTION_STATUSES,
  inspectionErrorText,
  inspectionQuery,
  issueInspection,
  itemRefs,
  reopenInspection,
  saveInspection,
  saveItem,
  schemeOptionsQuery,
  setItemPoint,
  sectionLabel,
  setScheme,
  setSection,
  signInspection,
  STATUS_STYLE,
  type InspectionFull,
  type InspectionItem,
  type InspectionPhoto,
  type InspectionSection,
  type SchemeOption,
  type ItemStatus,
} from '@/features/inspections/api'
import { ReportStatusBadge, ResultBadge } from '@/features/inspections/badges'
import { downloadInspectionPdf } from '@/features/inspections/pdf'
import { SignaturePad, type SignaturePadHandle } from '@/features/inspections/signature-pad'
import { schemeImageQuery, type SchemeSource } from '@/features/inspections/scheme-image'
import { TaskTracker } from '@/features/inspections/task-tracker'
import { SchemePanZoom } from '@/features/inspections/scheme-pan-zoom'
import { SchemeView, type SchemeMarker } from '@/features/inspections/scheme-view'
import { StoredImage } from '@/features/inspections/stored-image'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { myPermissionsQuery, projectByCodeQuery, projectMembersQuery } from '@/features/projects/api'
import { CATEGORY_STYLES } from '@/features/tasks/api'
import { UserAvatar } from '@/features/profile/avatar'
import { organizationsListQuery } from '@/features/volumes/api'
import { currentLocale } from '@/lib/i18n'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

// Паттерн «Detail / Record»: отчёт об инспекции — шапка, схема места, разделы с замечаниями, фото, подписи
export const Route = createFileRoute('/_app/projects/$code/inspection/$id')({
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) throw notFound()
    const full = await queryClient.ensureQueryData(inspectionQuery(params.id))
    if (!full) throw notFound()
    await Promise.all([queryClient.ensureQueryData(myPermissionsQuery(project.id)), queryClient.ensureQueryData(locationsQuery(project.id)), queryClient.ensureQueryData(organizationsListQuery)])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем отчёт…')}</p>,
  component: InspectionPage,
})

function InspectionPage() {
  const { code, id } = Route.useParams()
  const queryClient = useQueryClient()
  const { tenantId: tenant } = useAuth()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: full } = useSuspenseQuery(inspectionQuery(id))
  const { data: perms } = useSuspenseQuery(myPermissionsQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { report: r, sections, items, photos } = full!
  const tenantId = tenant ?? ''
  const canConduct = perms.includes('inspection.conduct')
  const canEdit = canConduct && r.status === 'draft'
  // задачи раздают по замечаниям и у выданного отчёта: после выдачи работа как раз начинается
  const canAssign = canConduct && perms.includes('task.create')
  const canPickAssignee = perms.includes('task.assign')
  const refs = itemRefs(sections, items)
  const placeText = r.location ? locationLabel(r.location.path, locations) : tr('Место не указано')
  const dateText = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${r.inspection_date}T12:00:00`))

  const [editingHead, setEditingHead] = useState(false)
  const [signing, setSigning] = useState<'client' | 'contractor' | null>(null)
  const [viewer, setViewer] = useState<string | null>(null)
  const [pickScheme, setPickScheme] = useState(false)
  const [pointFor, setPointFor] = useState<string | null>(null)
  const [viewScheme, setViewScheme] = useState(false)
  const [newSection, setNewSection] = useState(false)
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['inspection', id] }), queryClient.invalidateQueries({ queryKey: ['inspections', p.id] })])
  }
  /** Запускает действие, обновляет отчёт и показывает понятную ошибку. */
  const run = useMutation({
    mutationFn: async (job: { fn: () => Promise<unknown>; done?: string }) => {
      await job.fn()
      return job.done
    },
    onSuccess: async (done) => {
      await refresh()
      if (done) toast.success(done)
    },
    onError: async (e) => {
      toast.error(inspectionErrorText(e))
      await refresh()
    },
  })
  const act = (fn: () => Promise<unknown>, done?: string) => run.mutate({ fn, done })
  const busy = run.isPending

  const scheme = full!.scheme
  const { data: schemeOptions = [], isFetched: optionsReady } = useQuery(schemeOptionsQuery(r.status === 'draft' ? r.location_id : null))
  const { data: me } = useQuery(meQuery)
  // подписывает только тот, кто провёл инспекцию
  const canSign = canConduct && !!me && me.id === r.created_by
  const { data: taskList = [] } = useQuery(inspectionTasksQuery(items.flatMap((i) => (i.task_id ? [i.task_id] : []))))
  const tasks = new Map(taskList.map((t) => [t.id, t]))
  const needTask = items.filter((i) => (i.status === 'C' || i.status === 'R') && !(i.task_id && tasks.has(i.task_id)))
  const [assigning, setAssigning] = useState<'all' | string | null>(null)
  // у черновика без схемы подставляем схему места (отчёты, созданные до привязки схем, и места, где чертёж привязали позже)
  const autoScheme = useRef(false)
  useEffect(() => {
    if (autoScheme.current || !canEdit || !optionsReady || scheme || schemeOptions.length === 0) return
    autoScheme.current = true
    run.mutate({ fn: () => setScheme(r.id, schemeOptions[0]) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, optionsReady, scheme, schemeOptions.length])
  const markers: SchemeMarker[] = items
    .filter((i) => i.scheme_x !== null && i.scheme_y !== null)
    .map((i) => ({ id: i.id, label: refs.get(i.id) ?? '', x: Number(i.scheme_x), y: Number(i.scheme_y), status: i.status }))
  const generalPhotos = photos.filter((ph) => !ph.item_id)
  const noStatus = r.cnt_open

  async function exportPdf() {
    setExporting(true)
    await downloadInspectionPdf({
      projectName: `${p.code} · ${p.name}`,
      placeText,
      full: full!,
      urlOf: (key) => queryClient.fetchQuery(signedUrlQuery(key)),
      schemeUrl: scheme ? () => queryClient.fetchQuery(schemeImageQuery(scheme)) : undefined,
    })
    setExporting(false)
  }

  return (
    <div className="flex flex-col gap-4 print:gap-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <BackButton
          fallback={
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects/$code/inspections" params={{ code }}>
                {tr('Все инспекции')}
              </Link>
            </Button>
          }
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportPdf} disabled={exporting}>
            <FileDown /> PDF
          </Button>
          {canConduct && r.status === 'draft' && (
            <Button
              disabled={busy}
              onClick={() => {
                if (noStatus > 0) return toast.error(tr('У замечаний без статуса: {{n}}. Отметьте A, C или R у каждого.', { n: noStatus }))
                act(() => issueInspection(r.id), tr('Отчёт выдан'))
              }}
            >
              <Lock /> {tr('Выдать отчёт')}
            </Button>
          )}
          {canConduct && r.status === 'issued' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => window.confirm(tr('Открыть отчёт заново? Подписи будут сняты.')) && act(() => reopenInspection(r.id), tr('Отчёт открыт для правки'))}
            >
              <Undo2 /> {tr('Открыть заново')}
            </Button>
          )}
        </div>
      </div>

      {/* шапка отчёта, как в бумажной форме */}
      <section className="rounded-lg border bg-card p-4 shadow-soft print:shadow-none" aria-label={tr('Шапка отчёта')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="ident text-xs text-muted-foreground">{r.key}</p>
            <h1 className="text-xl font-semibold">{r.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ResultBadge result={r.result} />
            <ReportStatusBadge status={r.status} />
            {canEdit && (
              <Button variant="outline" size="sm" className="print:hidden max-sm:size-11 max-sm:p-0" aria-label={tr('Изменить данные')} onClick={() => setEditingHead(true)}>
                <Pencil /> <span className="max-sm:sr-only">{tr('Изменить данные')}</span>
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-col gap-1.5 text-sm sm:hidden">
          <p className="inline-flex items-start gap-1.5 font-medium">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {placeText}
          </p>
          <p className="text-muted-foreground">{[dateText, r.contractor?.name, r.author?.full_name].filter(Boolean).join(' · ')}</p>
          <p className="flex flex-wrap gap-1.5 text-xs font-medium tabular-nums" aria-label={tr('Принято {{a}}, с замечаниями {{c}}, не принято {{r}}', { a: r.cnt_a, c: r.cnt_c, r: r.cnt_r })}>
            {(['A', 'C', 'R'] as const).map((st) => (
              <span key={st} className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2">
                <span className={cn('grid size-5 place-items-center rounded-full text-[11px]', STATUS_STYLE[st].on)}>{st}</span>
                {st === 'A' ? r.cnt_a : st === 'C' ? r.cnt_c : r.cnt_r}
              </span>
            ))}
          </p>
        </div>
        <dl className="mt-3 hidden grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid lg:grid-cols-4">
          <Field label={tr('Проект')}>{p.name}</Field>
          <Field label={tr('Место')} wide>
            <span className="inline-flex items-start gap-1">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {placeText}
            </span>
          </Field>
          <Field label={tr('Подрядчик')}>{r.contractor?.name ?? '—'}</Field>
          <Field label={tr('Дата инспекции')}>{dateText}</Field>
          <Field label={tr('Провёл')}>{r.author?.full_name ?? '—'}</Field>
          <Field label={tr('Принято')}>{r.cnt_a}</Field>
          <Field label={tr('С замечаниями')}>{r.cnt_c}</Field>
          <Field label={tr('Не принято')}>{r.cnt_r}</Field>
        </dl>
        {r.note && <p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{r.note}</p>}
      </section>

      {/* схема места: берётся от места, свою загружать нельзя; на ней отмечаются точки замечаний */}
      <section className="rounded-lg border bg-card p-4 shadow-soft break-inside-avoid print:shadow-none" aria-label={tr('Схема места')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{tr('Схема места')}</h2>
          {canEdit && schemeOptions.length > 1 && (
            <Button variant="outline" size="sm" className="print:hidden max-sm:h-11" onClick={() => setPickScheme(true)}>
              <ImagePlus /> {tr('Другая схема')}
            </Button>
          )}
        </div>
        {scheme ? (
          <div className="mt-3 flex flex-col gap-2">
            <SchemeView source={scheme} alt={tr('Схема места: {{title}}', { title: r.title })} markers={markers} onOpen={() => setViewScheme(true)} />
            {canEdit && markers.length === 0 && <p className="text-xs text-muted-foreground print:hidden">{tr('Чтобы показать, где проблема, откройте замечание и нажмите «Отметить на схеме».')}</p>}
          </div>
        ) : (
          <div className="mt-2 flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <p>{r.location_id ? tr('У этого места нет схемы. Привяжите к месту план или чертёж в «Документах» либо отметьте изображение места как схему: рендеры в отчёт не попадают.') : tr('Выберите место, и схема подставится сама.')}</p>
            {r.location && (
              <Button asChild variant="outline" size="sm" className="print:hidden max-sm:h-11">
                <Link to="/projects/$code/locations/$path" params={{ code, path: r.location.path }}>
                  <ImagePlus /> {tr('Прикрепить схему к месту')}
                </Link>
              </Button>
            )}
          </div>
        )}
        {r.scheme_text && <p className="mt-2 whitespace-pre-wrap text-sm">{r.scheme_text}</p>}
        {!r.scheme_text && canEdit && (
          <button type="button" onClick={() => setEditingHead(true)} className="mt-1 text-sm text-primary underline-offset-2 hover:underline print:hidden">
            {tr('Добавить описание схемы')}
          </button>
        )}
      </section>

      {/* задачи по замечаниям: отслеживание прямо в отчёте */}
      <TaskTracker
        code={code}
        remarks={items.filter((i) => i.status === 'C' || i.status === 'R').map((i) => ({ item: i, ref: refs.get(i.id) ?? '' }))}
        tasks={tasks}
        canAssign={canAssign}
        canConduct={canConduct}
        busy={busy}
        onAssign={setAssigning}
        onResolve={(id, resolved) => act(() => resolveItem(id, resolved), resolved ? tr('Замечание отмечено устранённым') : undefined)}
      />

      {/* чек-лист */}
      <section className="flex flex-col gap-3" aria-label={tr('Чек-лист')}>
        {sections.map((s, si) => (
          <SectionBlock
            key={s.id}
            index={si + 1}
            section={s}
            items={items.filter((i) => i.section_id === s.id)}
            photos={photos}
            refs={refs}
            canEdit={canEdit}
            busy={busy}
            lastAdded={lastAdded}
            onView={setViewer}
            act={act}
            reportId={r.id}
            projectId={p.id}
            tenantId={tenantId}
            onAdded={setLastAdded}
            hasScheme={!!scheme}
            onPoint={setPointFor}
            code={code}
            tasks={tasks}
            canAssign={canAssign}
            onAssign={setAssigning}
          />
        ))}
        {canEdit && (
          <div className="print:hidden">
            <Button variant="outline" size="sm" onClick={() => setNewSection(true)}>
              <Plus /> {tr('Добавить раздел')}
            </Button>
          </div>
        )}
      </section>

      {/* общие фото */}
      <section className="rounded-lg border bg-card p-4 shadow-soft print:shadow-none" aria-label={tr('Фото')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{tr('Общие фото')}</h2>
          {canEdit && (
            <PhotoButtons
              label={tr('Добавить фото')}
              disabled={busy}
              onFiles={(files) =>
                run.mutate({
                  fn: async () => {
                    const failed = await addPhotos({ reportId: r.id, projectId: p.id, tenantId, files })
                    if (failed.length > 0) throw new Error('upload_failed')
                  },
                  done: tr('Фото добавлены'),
                })
              }
            />
          )}
        </div>
        {generalPhotos.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{tr('Общих фото нет.')}</p>
        ) : (
          <PhotoGrid photos={generalPhotos} canEdit={canEdit} onView={setViewer} onDelete={(ph) => act(() => deletePhoto(ph.id))} />
        )}
      </section>

      {/* подписи */}
      <section className="grid gap-3 sm:grid-cols-2 break-inside-avoid" aria-label={tr('Подписи')}>
        <SignatureBox
          label={tr('Заказчик')}
          name={r.client_name}
          at={r.client_signed_at}
          fileKey={r.client_sign_file_id ? full!.fileKeys[r.client_sign_file_id] : undefined}
          canSign={canSign}
          busy={busy}
          onSign={() => setSigning('client')}
          onClear={() => act(() => clearSignature(r.id, 'client'))}
        />
        <SignatureBox
          label={tr('Подрядчик')}
          name={r.contractor_name}
          at={r.contractor_signed_at}
          fileKey={r.contractor_sign_file_id ? full!.fileKeys[r.contractor_sign_file_id] : undefined}
          canSign={canSign}
          busy={busy}
          onSign={() => setSigning('contractor')}
          onClear={() => act(() => clearSignature(r.id, 'contractor'))}
        />
      </section>

      {canConduct && (
        <div className="print:hidden">
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(tr('Удалить отчёт {{key}}?', { key: r.key }))) return
              try {
                await deleteInspection(r.id)
                await queryClient.invalidateQueries({ queryKey: ['inspections', p.id] })
                if (window.history.length > 1) window.history.back()
                else window.location.href = `/projects/${code}/inspections`
              } catch (e) {
                toast.error(inspectionErrorText(e))
              }
            }}
          >
            <Trash2 /> {tr('Удалить отчёт')}
          </Button>
        </div>
      )}

      {editingHead && <HeadDialog full={full!} projectId={p.id} onClose={() => setEditingHead(false)} onSaved={refresh} />}
      {signing && (
        <SignDialog
          side={signing}
          onClose={() => setSigning(null)}
          onSubmit={async (name, drawing) => {
            await signInspection({ reportId: r.id, projectId: p.id, tenantId, side: signing, name, drawing })
            await refresh()
          }}
        />
      )}
      {pickScheme && <SchemePicker options={schemeOptions} current={{ fileId: r.scheme_file_id, versionId: r.scheme_version_id }} onClose={() => setPickScheme(false)} onPick={(option) => act(() => setScheme(r.id, option), tr('Схема выбрана'))} />}
      {assigning && (
        <AssignDialog
          projectId={p.id}
          all={assigning === 'all'}
          rows={needTask.map((i) => ({ id: i.id, ref: refs.get(i.id) ?? '', comment: i.comment, status: i.status }))}
          defaultOrg={r.contractor_org_id}
          canPickAssignee={canPickAssignee}
          onClose={() => setAssigning(null)}
          onSubmit={async (to) => {
            await assignItem(assigning, to)
            toast.success(tr('Задача создана'))
            await refresh()
            await queryClient.invalidateQueries({ queryKey: ['tasks', p.id] })
          }}
          onSubmitMany={async (entries) => {
            const n = await assignMany(r.id, entries)
            toast.success(tr('Создано задач: {{n}}', { n }))
            await refresh()
            await queryClient.invalidateQueries({ queryKey: ['tasks', p.id] })
          }}
        />
      )}
      {viewScheme && scheme && (
        <Dialog open onOpenChange={(o) => !o && setViewScheme(false)}>
          <DialogContent className="max-h-[94svh] sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{tr('Схема места')}</DialogTitle>
              <DialogDescription>{tr('Двумя пальцами или колесом мыши увеличьте, перетащите, чтобы сдвинуть.')}</DialogDescription>
            </DialogHeader>
            <SchemePanZoom source={scheme} alt={tr('Схема места: {{title}}', { title: r.title })} markers={markers} heightClass="h-[68svh]" />
          </DialogContent>
        </Dialog>
      )}
      {pointFor && scheme && (
        <PointDialog
          source={scheme}
          item={items.find((i) => i.id === pointFor)!}
          refLabel={refs.get(pointFor) ?? ''}
          markers={markers}
          onClose={() => setPointFor(null)}
          onSave={async (point) => {
            await setItemPoint(pointFor, point)
            await refresh()
          }}
        />
      )}
      {newSection && (
        <NewSectionDialog
          onClose={() => setNewSection(false)}
          onSubmit={async (title) => {
            await addSection(r.id, title)
            await refresh()
          }}
        />
      )}
      <Viewer storageKey={viewer} onClose={() => setViewer(null)} />
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-0.5', wide && 'col-span-2 lg:col-span-1')}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

/** Кнопка выбора файлов: скрытое поле ввода внутри. С `capture` на телефоне сразу открывается камера (задняя). */
function FileButton({ label, accept, multiple, disabled, capture, icon: Icon = Camera, onFiles }: { label: string; accept: string; multiple?: boolean; disabled?: boolean; capture?: boolean; icon?: typeof Camera; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
      <Button type="button" variant="outline" size="sm" className="max-sm:h-11 max-sm:px-4" disabled={disabled} onClick={() => input.current?.click()}>
        <Icon /> {label}
      </Button>
    </>
  )
}

/**
 * Добавление фото: на телефоне две кнопки, «Снять» (камера) и «Из галереи» (несколько снимков сразу), на компьютере одна
 * общая. Снимок с камеры уходит в отчёт сразу после съёмки.
 */
function PhotoButtons({ onFiles, disabled, label = tr('Фото') }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  return (
    <>
      <span className="flex gap-2 sm:hidden">
        <FileButton label={tr('Снять')} accept="image/*" capture disabled={disabled} onFiles={onFiles} />
        <FileButton label={tr('Из галереи')} accept="image/*" multiple icon={ImagePlus} disabled={disabled} onFiles={onFiles} />
      </span>
      <span className="hidden sm:inline-flex">
        <FileButton label={label} accept="image/*" multiple disabled={disabled} onFiles={onFiles} />
      </span>
    </>
  )
}

function PhotoGrid({ photos, canEdit, onView, onDelete }: { photos: InspectionPhoto[]; canEdit: boolean; onView: (key: string) => void; onDelete: (p: InspectionPhoto) => void }) {
  return (
    <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {photos.map((ph) => (
        <li key={ph.id} className="relative aspect-square">
          <StoredImage storageKey={ph.file.storage_key} alt={ph.caption || ph.file.name} onClick={() => onView(ph.file.storage_key)} className="size-full rounded-md border" />
          {canEdit && (
            <button
              type="button"
              aria-label={tr('Убрать фото')}
              onClick={() => onDelete(ph)}
              className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring print:hidden"
            >
              <X className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function SectionBlock(props: {
  index: number
  section: InspectionSection
  items: InspectionItem[]
  photos: InspectionPhoto[]
  refs: Map<string, string>
  canEdit: boolean
  busy: boolean
  lastAdded: string | null
  onView: (key: string) => void
  act: (fn: () => Promise<unknown>, done?: string) => void
  reportId: string
  projectId: string
  tenantId: string
  onAdded: (id: string) => void
  hasScheme: boolean
  onPoint: (itemId: string) => void
  code: string
  tasks: Map<string, InspectionTask>
  canAssign: boolean
  onAssign: (itemId: string) => void
}) {
  const { section: s, items, canEdit, busy, act } = props
  const label = sectionLabel(s)
  const hasRemarks = items.some((i) => i.status === 'C' || i.status === 'R')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(label)

  return (
    <div className="rounded-lg border bg-card shadow-soft break-inside-avoid print:shadow-none">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <h2 className="text-sm font-semibold">
          <span className="tabular-nums text-muted-foreground">{props.index}.</span>{' '}
          {renaming ? (
            <Input
              autoFocus
              value={name}
              maxLength={120}
              aria-label={tr('Название раздела')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setRenaming(false)
                if (name.trim() && name.trim() !== label) act(() => setSection(s.id, { title: name.trim() }))
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              className="inline-block h-8 w-56"
            />
          ) : (
            label
          )}
        </h2>
        {s.ok && items.length === 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium">
            <Check className="size-3.5" aria-hidden /> {tr('Без замечаний')}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-1 print:hidden">
            {items.length === 0 && (
              <Button variant={s.ok ? 'secondary' : 'outline'} size="sm" disabled={busy || hasRemarks} aria-pressed={s.ok} onClick={() => act(() => setSection(s.id, { ok: !s.ok }))}>
                <Check /> {tr('Без замечаний')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                act(async () => props.onAdded(await saveItem(s.id, { comment: '', status: null })))
              }}
            >
              <Plus /> {tr('Замечание')}
            </Button>
            {!s.code && (
              <Button variant="ghost" size="icon" aria-label={tr('Переименовать раздел')} onClick={() => setRenaming(true)}>
                <Pencil />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={tr('Удалить раздел')}
              disabled={busy}
              onClick={() => (items.length === 0 || window.confirm(tr('Удалить раздел «{{name}}» вместе с замечаниями?', { name: label }))) && act(() => deleteSection(s.id))}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{s.ok ? tr('Раздел проверен, замечаний нет.') : tr('Не проверялся или замечаний не записано.')}</p>
      ) : (
        <ul className="divide-y">
          {items.map((it) => (
            <li key={it.id}>
              <ItemRow {...props} item={it} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ItemRow({ item, refs, canEdit, busy, act, photos, onView, lastAdded, reportId, projectId, tenantId, hasScheme, onPoint, code, tasks, canAssign, onAssign }: Parameters<typeof SectionBlock>[0] & { item: InspectionItem }) {
  const task = item.task_id ? tasks.get(item.task_id) : undefined
  const isRemark = item.status === 'C' || item.status === 'R'
  const [comment, setComment] = useState(item.comment)
  const mine = photos.filter((ph) => ph.item_id === item.id)
  const save = (status: ItemStatus | null, text = comment) => act(() => saveItem(item.section_id, { id: item.id, comment: text, status }))

  const statusButtons = (
    <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-1.5 sm:flex" role="group" aria-label={tr('Статус')}>
      {(['A', 'C', 'R'] as const).map((st) => {
        const on = item.status === st
        return canEdit ? (
          <button
            key={st}
            type="button"
            aria-pressed={on}
            title={INSPECTION_STATUSES[st]}
            disabled={busy}
            onClick={() => save(on ? null : st)}
            className={cn('grid h-12 place-items-center rounded-md border text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-11 sm:text-sm', on ? STATUS_STYLE[st].on : cn('bg-background', STATUS_STYLE[st].off))}
          >
            {st}
          </button>
        ) : (
          on && (
            <span key={st} title={INSPECTION_STATUSES[st]} className={cn('grid size-9 place-items-center rounded-md border text-sm font-semibold', STATUS_STYLE[st].on)}>
              {st}
            </span>
          )
        )
      })}
      {!canEdit && !item.status && <span className="text-sm text-muted-foreground">—</span>}
      {canEdit && (
        <Button variant="ghost" size="icon" className="max-sm:size-12" aria-label={tr('Удалить замечание')} disabled={busy} onClick={() => act(() => deleteItem(item.id))}>
          <Trash2 />
        </Button>
      )}
    </div>
  )

  // Телефон: номер и комментарий → крупные кнопки статуса → фото. Компьютер: комментарий и фото слева, статус справа.
  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1 gap-y-2.5 p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:gap-x-2">
      <span className="ident col-start-1 row-start-1 pt-2 text-sm tabular-nums text-muted-foreground">{refs.get(item.id)}</span>
      <div className="col-start-2 row-start-1 min-w-0">
        {canEdit ? (
          <Textarea
            value={comment}
            autoFocus={lastAdded === item.id}
            rows={2}
            maxLength={2000}
            aria-label={tr('Комментарий к замечанию {{ref}}', { ref: refs.get(item.id) ?? '' })}
            placeholder={tr('Что не так и что исправить')}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => comment !== item.comment && save(item.status)}
          />
        ) : (
          <p className="whitespace-pre-wrap pt-1.5 text-sm">{item.comment || '—'}</p>
        )}
      </div>
      <div className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1">{statusButtons}</div>
      {(mine.length > 0 || canEdit) && (
        <div className="col-span-2 row-start-3 flex min-w-0 flex-col gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-2">
          {mine.length > 0 && <PhotoGrid photos={mine} canEdit={canEdit} onView={onView} onDelete={(ph) => act(() => deletePhoto(ph.id))} />}
          {canEdit && (
            <span className="flex flex-wrap gap-2 print:hidden">
              {hasScheme && (
                <Button type="button" variant={item.scheme_x !== null ? 'secondary' : 'outline'} size="sm" className="max-sm:h-11 max-sm:px-4" disabled={busy} onClick={() => onPoint(item.id)}>
                  <MapPin /> {item.scheme_x !== null ? tr('Точка на схеме') : tr('Отметить на схеме')}
                </Button>
              )}
              <PhotoButtons
                disabled={busy}
                onFiles={(files) =>
                  act(async () => {
                    const failed = await addPhotos({ reportId, projectId, tenantId, itemId: item.id, files })
                    if (failed.length > 0) throw new Error('upload_failed')
                  })
                }
              />
            </span>
          )}
        </div>
      )}
      {(task || (canAssign && isRemark)) && (
        <div className="col-span-2 row-start-4 flex min-w-0 flex-wrap items-center gap-2 print:hidden sm:col-span-1 sm:col-start-2 sm:row-start-3">
          {task ? (
            <Link
              to="/projects/$code/task/$key"
              params={{ code, key: task.key }}
              className="flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="ident font-medium">{task.key}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', CATEGORY_STYLES[task.status_category])}>{task.status?.name ?? task.status_category}</span>
              <span className="truncate text-muted-foreground">{[task.assignee?.full_name, task.due_date ? new Date(`${task.due_date}T12:00:00`).toLocaleDateString(currentLocale(), { day: 'numeric', month: 'short' }) : null].filter(Boolean).join(' · ')}</span>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11 max-sm:px-4" disabled={busy} onClick={() => onAssign(item.id)}>
              <UserPlus /> {tr('Назначить')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function SignatureBox({ label, name, at, fileKey, canSign, busy, onSign, onClear }: { label: string; name: string | null; at: string | null; fileKey?: string; canSign: boolean; busy: boolean; onSign: () => void; onClear: () => void }) {
  const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="flex min-h-36 flex-col gap-2 rounded-lg border bg-card p-4 shadow-soft print:shadow-none">
      <h2 className="text-sm font-semibold">{label}</h2>
      {name ? (
        <>
          {fileKey && <StoredImage storageKey={fileKey} alt={tr('Подпись: {{name}}', { name })} className="h-20 w-48 rounded border bg-white [&_img]:object-contain" />}
          <p className="text-sm font-medium">{name}</p>
          {at && <p className="text-xs text-muted-foreground">{dateFmt.format(new Date(at))}</p>}
          {canSign && (
            <Button variant="ghost" size="sm" className="mt-auto self-start print:hidden" disabled={busy} onClick={onClear}>
              <X /> {tr('Снять подпись')}
            </Button>
          )}
        </>
      ) : (
        <>
          <div className="mt-auto h-12 border-b border-dashed" aria-hidden />
          {canSign ? (
            <Button variant="outline" size="sm" className="self-start print:hidden" onClick={onSign}>
              <Pencil /> {tr('Подписать')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{tr('Не подписано. Подписывает тот, кто провёл инспекцию.')}</p>
          )}
        </>
      )}
    </div>
  )
}

function Viewer({ storageKey, onClose }: { storageKey: string | null; onClose: () => void }) {
  const { data: url } = useQuery({ ...signedUrlQuery(storageKey ?? ''), enabled: !!storageKey })
  return (
    <Dialog open={!!storageKey} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="sr-only">{tr('Просмотр изображения')}</DialogTitle>
          <DialogDescription className="sr-only">{tr('Изображение из отчёта на весь экран')}</DialogDescription>
        </DialogHeader>
        {url ? <img src={url} alt="" className="max-h-[75svh] w-full rounded-md object-contain" /> : <p className="text-sm text-muted-foreground">{tr('Загружаем…')}</p>}
      </DialogContent>
    </Dialog>
  )
}

function HeadDialog({ full, projectId, onClose, onSaved }: { full: InspectionFull; projectId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const r = full.report
  const orgOptions = useOrgOptions()
  const [placeId, setPlaceId] = useState<string | null>(r.location_id)
  const [title, setTitle] = useState(r.title)
  const [date, setDate] = useState(r.inspection_date)
  const [orgId, setOrgId] = useState(r.contractor_org_id ?? '')
  const [schemeText, setSchemeText] = useState(r.scheme_text)
  const [note, setNote] = useState(r.note)
  const save = useMutation({
    mutationFn: () => saveInspection(projectId, { id: r.id, locationId: placeId, title, date, contractorId: orgId || null, schemeText, note }),
    onSuccess: async () => {
      await onSaved()
      onClose()
    },
    onError: (e) => toast.error(inspectionErrorText(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tr('Данные отчёта')}</DialogTitle>
          <DialogDescription>{tr('Место, подрядчик, дата, описание схемы и общее замечание.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{tr('Место (этаж, зона, помещение)')}</Label>
            <LocationPicker projectId={projectId} value={placeId} onChange={setPlaceId} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="h-title">{tr('Название отчёта')}</Label>
            <Input id="h-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="h-date">{tr('Дата инспекции')}</Label>
              <DatePicker id="h-date" value={date} onChange={setDate} clearable={false} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="h-org">{tr('Подрядчик')}</Label>
              <SearchSelect value={orgId} onChange={setOrgId} options={orgOptions} noneLabel={tr('Не указан')} ariaLabel={tr('Подрядчик')} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="h-scheme">{tr('Описание схемы места')}</Label>
            <Textarea id="h-scheme" rows={3} maxLength={4000} value={schemeText} onChange={(e) => setSchemeText(e.target.value)} placeholder={tr('Например: вход слева, санузел справа, окно на север')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="h-note">{tr('Общее замечание')}</Label>
            <Textarea id="h-note" rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={save.isPending || (!placeId && !title.trim())} onClick={() => save.mutate()}>
            {tr('Сохранить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SignDialog({ side, onClose, onSubmit }: { side: 'client' | 'contractor'; onClose: () => void; onSubmit: (name: string, drawing: Blob | null) => Promise<void> }) {
  const pad = useRef<SignaturePadHandle>(null)
  // фамилия и имя подставляются из профиля подписывающего; можно исправить (например, если подписывает другой человек)
  const { data: me } = useQuery(meQuery)
  const [typed, setTyped] = useState<string | null>(null)
  const locked = side === 'client'
  const name = locked ? (me?.full_name ?? '') : (typed ?? me?.full_name ?? '')
  const setName = setTyped
  const [pending, setPending] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{side === 'client' ? tr('Подпись заказчика') : tr('Подпись подрядчика')}</DialogTitle>
          <DialogDescription>{side === 'client' ? tr('Распишитесь пальцем или мышью.') : tr('Укажите, кто принимает отчёт со стороны подрядчика, и дайте расписаться.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sig-name">{tr('Фамилия и имя')}</Label>
            <Input id="sig-name" value={name} readOnly={locked} onChange={(e) => setName(e.target.value)} onFocus={(e) => !locked && e.currentTarget.select()} maxLength={200} autoFocus={!locked} autoComplete="name" />
            <p className="text-xs text-muted-foreground">{locked ? tr('Подписывает тот, кто провёл инспекцию: имя берётся из профиля.') : tr('Имя представителя подрядчика, который принимает отчёт.')}</p>
          </div>
          <SignaturePad ref={pad} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button
            disabled={pending || !name.trim()}
            onClick={async () => {
              setPending(true)
              try {
                await onSubmit(name.trim(), await (pad.current?.toBlob() ?? Promise.resolve(null)))
                onClose()
              } catch (e) {
                toast.error(inspectionErrorText(e))
                setPending(false)
              }
            }}
          >
            {tr('Подписать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NewSectionDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('Новый раздел')}</DialogTitle>
          <DialogDescription>{tr('Например: лоджия, кладовая, вентиляция.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sec-title">{tr('Название раздела')}</Label>
          <Input id="sec-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button
            disabled={pending || !title.trim()}
            onClick={async () => {
              setPending(true)
              try {
                await onSubmit(title.trim())
                onClose()
              } catch (e) {
                toast.error(inspectionErrorText(e))
                setPending(false)
              }
            }}
          >
            {tr('Добавить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Миниатюра варианта схемы; PDF-чертёж рисуется в браузере в уменьшенном размере. */
function OptionThumb({ option }: { option: SchemeOption }) {
  const { data: url } = useQuery(schemeImageQuery({ storageKey: option.storage_key, mime: option.mime }, 480))
  return url ? <img src={url} alt="" className="aspect-square w-full object-contain" /> : <span className="block aspect-square animate-pulse bg-muted" />
}

/** Выбор другой схемы среди тех, что привязаны к месту: изображения, планы и чертежи места, типа номера и вышестоящих узлов. */
function SchemePicker({ options, current, onClose, onPick }: { options: SchemeOption[]; current: { fileId: string | null; versionId: string | null }; onClose: () => void; onPick: (option: SchemeOption) => void }) {
  const source: Record<SchemeOption['source'], string> = { location: tr('Это место'), room_type: tr('Тип номера'), parent: tr('Выше по структуре') }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tr('Схемы этого места')}</DialogTitle>
          <DialogDescription>{tr('Выберите схему. Точки замечаний на прежней схеме будут сняты.')}</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((o) => {
            const on = (o.file_id !== null && o.file_id === current.fileId) || (o.version_id !== null && o.version_id === current.versionId)
            return (
              <li key={o.file_id ?? o.version_id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (!on) onPick(o)
                    onClose()
                  }}
                  className={cn('block w-full overflow-hidden rounded-md border bg-white outline-none hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring', on && 'ring-2 ring-primary')}
                >
                  <OptionThumb option={o} />
                  <span className="block truncate bg-card px-2 py-1 text-left text-xs">{o.title}</span>
                  <span className="block bg-card px-2 pb-1 text-left text-[11px] text-muted-foreground">
                    {o.kind === 'document' ? tr('Чертёж') : tr('Изображение')} · {source[o.source]}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** Отметка точки замечания на схеме: нажать на схему там, где проблема; «Сохранить точку» запоминает её. */
function PointDialog({ source, item, refLabel, markers, onClose, onSave }: { source: SchemeSource; item: InspectionItem; refLabel: string; markers: SchemeMarker[]; onClose: () => void; onSave: (point: { x: number; y: number } | null) => Promise<void> }) {
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(item.scheme_x !== null && item.scheme_y !== null ? { x: Number(item.scheme_x), y: Number(item.scheme_y) } : null)
  const [pending, setPending] = useState(false)
  const submit = async (point: { x: number; y: number } | null) => {
    setPending(true)
    try {
      await onSave(point)
      onClose()
    } catch (e) {
      toast.error(inspectionErrorText(e))
      setPending(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr('Где проблема: замечание {{ref}}', { ref: refLabel })}</DialogTitle>
          <DialogDescription>{tr('Нажмите на схему в том месте, где проблема.')}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{tr('Двумя пальцами увеличьте схему, одним сдвиньте, затем коснитесь места проблемы.')}</p>
        <SchemePanZoom source={source} alt={tr('Схема места')} markers={markers.filter((m) => m.id !== item.id)} draft={draft} onPick={setDraft} heightClass="h-[56svh]" />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={pending || (item.scheme_x === null && !draft)} onClick={() => (item.scheme_x === null ? setDraft(null) : submit(null))}>
            <X /> {tr('Убрать точку')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {tr('Отмена')}
            </Button>
            <Button disabled={pending || !draft} onClick={() => submit(draft)}>
              {tr('Сохранить точку')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Участники проекта для выбора исполнителя: фото, имя, организация или роль. */
function usePeopleOptions(projectId: string): SearchOption[] {
  const { data: members = [] } = useQuery(projectMembersQuery(projectId))
  return members.flatMap((m) =>
    m.user ? [{ value: m.user.id, label: m.user.full_name, hint: m.organization?.name ?? m.role?.name ?? undefined, avatar: <UserAvatar name={m.user.full_name} path={m.user.avatar_path} className="size-8 text-xs" /> }] : [],
  )
}

/** Организации для выбора подрядчика. */
function useOrgOptions(): SearchOption[] {
  const { data: orgs = [] } = useQuery(organizationsListQuery)
  return orgs.map((o) => ({
    value: o.id,
    label: o.name,
    avatar: (
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Building2 className="size-4" />
      </span>
    ),
  }))
}

type Row = { on: boolean; assignee: string; org: string; due: string }

/**
 * Выдача задач по замечаниям. Одно замечание: исполнитель, подрядчик, срок. Несколько: список, где у каждого замечания свой
 * исполнитель, свой подрядчик и свой срок; галочкой замечание можно исключить, а верхний блок «Всем сразу» выставляет одно и то же
 * во всех строках. Исполнитель и подрядчик выбираются поиском (у людей с фото).
 */
function AssignDialog({
  projectId,
  all,
  rows,
  defaultOrg,
  canPickAssignee,
  onClose,
  onSubmit,
  onSubmitMany,
}: {
  projectId: string
  all: boolean
  rows: { id: string; ref: string; comment: string; status: ItemStatus | null }[]
  defaultOrg: string | null
  canPickAssignee: boolean
  onClose: () => void
  onSubmit: (to: { assigneeId: string | null; due: string | null; orgId: string | null }) => Promise<void>
  onSubmitMany: (entries: { item: string; assignee: string | null; due: string | null; org: string | null }[]) => Promise<void>
}) {
  const people = usePeopleOptions(projectId)
  const orgs = useOrgOptions()
  const week = () => new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv')
  const [one, setOne] = useState<Omit<Row, 'on'>>({ assignee: '', org: defaultOrg ?? '', due: week() })
  const [every, setEvery] = useState<Omit<Row, 'on'>>({ assignee: '', org: defaultOrg ?? '', due: week() })
  const [each, setEach] = useState<Record<string, Row>>(() => Object.fromEntries(rows.map((x) => [x.id, { on: true, assignee: '', org: defaultOrg ?? '', due: week() }])))
  const [pending, setPending] = useState(false)
  const chosen = rows.filter((x) => each[x.id]?.on)
  const setRow = (id: string, patch: Partial<Row>) => setEach((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  const setAll = (patch: Partial<Omit<Row, 'on'>>) => {
    setEvery((prev) => ({ ...prev, ...patch }))
    setEach((prev) => Object.fromEntries(Object.entries(prev).map(([id, v]) => [id, { ...v, ...patch }])))
  }

  const submit = async () => {
    setPending(true)
    try {
      if (all) await onSubmitMany(chosen.map((x) => ({ item: x.id, assignee: each[x.id].assignee || null, due: each[x.id].due || null, org: each[x.id].org || null })))
      else await onSubmit({ assigneeId: one.assignee || null, due: one.due || null, orgId: one.org || null })
      onClose()
    } catch (e) {
      toast.error(inspectionErrorText(e))
      setPending(false)
    }
  }

  const fields = (v: Omit<Row, 'on'>, set: (patch: Partial<Omit<Row, 'on'>>) => void, name: string) => (
    <div className={cn('grid gap-2', canPickAssignee ? 'sm:grid-cols-2' : '')}>
      {canPickAssignee && <SearchSelect value={v.assignee} onChange={(assignee) => set({ assignee })} options={people} noneLabel={tr('Не назначать человека')} ariaLabel={tr('Исполнитель: {{ref}}', { ref: name })} />}
      <SearchSelect value={v.org} onChange={(org) => set({ org })} options={orgs} noneLabel={tr('Подрядчик не указан')} ariaLabel={tr('Подрядчик: {{ref}}', { ref: name })} />
      <div className={canPickAssignee ? 'sm:col-span-2' : ''}>
        <DatePicker value={v.due} onChange={(due) => set({ due })} aria-label={tr('Срок: {{ref}}', { ref: name })} />
      </div>
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn('max-h-[94svh] overflow-y-auto', all && 'sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>{all ? tr('Раздать задачи: {{n}}', { n: rows.length }) : tr('Назначить задачу')}</DialogTitle>
          <DialogDescription>
            {all
              ? tr('У каждого замечания свой исполнитель, подрядчик и срок. Верхний блок выставляет одно и то же сразу во всех. Снимите галочку, если задача по замечанию не нужна.')
              : tr('По замечанию создастся задача «замечание» с текстом, фото и местом отчёта.')}
          </DialogDescription>
        </DialogHeader>

        {all ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
              <span className="text-sm font-medium">{tr('Всем сразу')}</span>
              {fields(every, setAll, tr('все'))}
            </div>
            <ul className="flex flex-col gap-2">
              {rows.map((x) => {
                const v = each[x.id]
                return (
                  <li key={x.id} className={cn('flex flex-col gap-2 rounded-lg border bg-card p-3', !v.on && 'opacity-55')}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 size-5 shrink-0" checked={v.on} onChange={(e) => setRow(x.id, { on: e.target.checked })} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="ident text-xs text-muted-foreground">{x.ref}</span>
                          {x.status && <span className={cn('grid size-5 place-items-center rounded-full text-[11px] font-semibold', STATUS_STYLE[x.status].on)}>{x.status}</span>}
                        </span>
                        <span className="line-clamp-2 text-sm">{x.comment || '—'}</span>
                      </span>
                    </label>
                    {v.on && fields(v, (patch) => setRow(x.id, patch), x.ref)}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          fields(one, (patch) => setOne((prev) => ({ ...prev, ...patch })), tr('замечание'))
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr('Отмена')}
          </Button>
          <Button disabled={pending || (all && chosen.length === 0)} onClick={submit}>
            {all ? tr('Создать задачи: {{n}}', { n: chosen.length }) : tr('Создать задачу')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
