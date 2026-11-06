import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { DocThumb } from '@/features/documents/doc-thumb'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BellRing, ChevronRight, Folder, FolderInput, FolderUp, GitCompareArrows, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { MobileFilters } from '@/components/mobile-filters'
import { useShowMore } from '@/components/show-more'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { disciplinesQuery, flattenDisciplines } from '@/features/disciplines/api'
import { ExportButton } from '@/features/export/export-button'
import { isoToDate } from '@/features/export/xlsx'
import { DOC_TYPE_LABELS, documentsQuery, searchDocumentsQuery, type DocumentRow } from '@/features/documents/api'
import { BulkUploadDialog } from '@/features/documents/bulk-upload-dialog'
import { FolderPanel, FolderPickerDialog, type FolderSelection } from '@/features/documents/folder-panel'
import { buildFolderTree, DRAG_TYPE, folderErrorText, foldersQuery, moveDocuments } from '@/features/documents/folders-api'
import { UploadDocumentDialog } from '@/features/documents/upload-dialog'
import { flattenTree, locationsQuery } from '@/features/locations/api'
import { myPermissionsQuery, projectByCodeQuery } from '@/features/projects/api'
import { DEFAULT_DISCIPLINE_STYLE, DISCIPLINE_STYLES } from '@/features/tasks/api'

// Паттерн «Список / Index»: документы проекта с действующими версиями, местами и направлениями
export const Route = createFileRoute('/_app/projects/$code/documents')({
  validateSearch: z.object({
    loc: z.string().optional(),
    disc: z.string().optional(),
    ack: z.boolean().optional(),
    create: z.enum(['upload', 'folder']).optional().catch(undefined), // из «Создать» в верхней панели
    folder: z.string().optional().catch(undefined), // 'root' — без папки, иначе id папки; пусто — все документы
  }),
  loader: async ({ context: { queryClient }, params }) => {
    const project = await queryClient.ensureQueryData(projectByCodeQuery(params.code))
    if (!project) return
    await Promise.all([
      queryClient.ensureQueryData(documentsQuery(project.id)),
      queryClient.ensureQueryData(foldersQuery(project.id)),
      queryClient.ensureQueryData(disciplinesQuery(project.id)),
      queryClient.ensureQueryData(locationsQuery(project.id)),
      queryClient.ensureQueryData(myPermissionsQuery(project.id)),
    ])
  },
  pendingComponent: () => <p className="text-sm text-muted-foreground">{tr('Загружаем документы…')}</p>,
  component: DocumentsPage,
})

const ALL = '__all__'
const dateFmt = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'short', year: 'numeric' })

/** Фрагмент найденного текста: слова в «ёлочках» подсвечиваются. Текст выводится как есть, разметка из файла не исполняется. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g)
  return (
    <span className="text-sm text-muted-foreground">
      {parts.map((part, i) =>
        part.startsWith('«') ? (
          <mark key={i} className="rounded bg-signal/40 px-0.5 text-foreground">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

function StatusBadge({ d }: { d: DocumentRow }) {
  if (d.ack_pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
        <BellRing className="size-3.5" aria-hidden />{tr('Ознакомьтесь')}</span>
    )
  }
  if (!d.current_version_id) {
    return <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tr('Черновик')}</span>
  }
  if (d.latest_status === 'draft') {
    return <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{tr('Есть черновик новой версии')}</span>
  }
  return null
}

function DocumentsPage() {
  const { code } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: project } = useSuspenseQuery(projectByCodeQuery(code))
  const p = project!
  const { data: docs } = useSuspenseQuery(documentsQuery(p.id))
  const { data: disciplineRows } = useSuspenseQuery(disciplinesQuery(p.id))
  const { data: locations } = useSuspenseQuery(locationsQuery(p.id))
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(p.id))
  const canUpload = permissions.includes('document.upload')
  const canThumbs = permissions.includes('comment.create')
  const canPublish = permissions.includes('document.publish')
  const queryClient = useQueryClient()
  const { data: folders } = useSuspenseQuery(foldersQuery(p.id))
  const { byId: folderById, flat: folderFlat } = useMemo(() => buildFolderTree(folders), [folders])
  const selectedFolder: FolderSelection = search.folder && (search.folder === 'root' || folderById.has(search.folder)) ? search.folder : 'all'
  const realFolderId = selectedFolder !== 'all' && selectedFolder !== 'root' ? selectedFolder : null
  const showPanel = canUpload || folders.length > 0
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moveOpen, setMoveOpen] = useState(false)

  const disciplines = useMemo(() => new Map(disciplineRows.map((d) => [d.id, d])), [disciplineRows])
  const locationNodes = useMemo(() => flattenTree(locations), [locations])
  const [query, setQuery] = useState('')
  const [type, setType] = useState(ALL)
  const [uploading, setUploading] = useState(false)
  const [folderUpload, setFolderUpload] = useState(false)
  useEffect(() => {
    if (search.create === 'upload' && canUpload) setUploading(true)
    if (search.create === 'folder' && canUpload) setFolderUpload(true)
    if (search.create) void navigate({ search: (prev) => ({ ...prev, create: undefined }), replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.create])
  const setSearch = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })

  // направление включает поднаправления
  const disciplineIds = useMemo(() => {
    if (!search.disc) return null
    const ids = new Set([search.disc])
    for (let grew = true; grew; ) {
      grew = false
      for (const d of disciplineRows) {
        if (d.parent_id && ids.has(d.parent_id) && !ids.has(d.id)) {
          ids.add(d.id)
          grew = true
        }
      }
    }
    return ids
  }, [search.disc, disciplineRows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs.filter(
      (d) =>
        // пока что-то ищут — ищем по всем папкам
        (q || selectedFolder === 'all' || (selectedFolder === 'root' ? !d.folder_id : d.folder_id === selectedFolder)) &&
        (!q || d.title.toLowerCase().includes(q) || (d.code ?? '').toLowerCase().includes(q)) &&
        (type === ALL || d.doc_type === type) &&
        (!disciplineIds || (d.discipline_id !== null && disciplineIds.has(d.discipline_id))) &&
        (!search.loc || d.location_paths.some((l) => l === search.loc || l.startsWith(search.loc + '.'))) &&
        (!search.ack || d.ack_pending),
    )
  }, [docs, query, type, disciplineIds, search.loc, search.ack, selectedFolder])
  const { shown, more } = useShowMore(visible, 40, `${query}|${search.disc}|${search.loc}|${type}|${search.ack}`)

  const pendingAck = docs.filter((d) => d.ack_pending).length

  const selectFolder = (f: FolderSelection) => {
    setPicked(new Set())
    setSearch({ folder: f === 'all' ? undefined : f })
  }
  const crumbs = realFolderId ? (() => {
    const out = []
    for (let cur = folderById.get(realFolderId); cur; cur = cur.parent_id ? folderById.get(cur.parent_id) : undefined) out.unshift(cur)
    return out
  })() : []
  const subfolders = realFolderId ? (folderById.get(realFolderId)?.children ?? []) : []
  const folderDocCount = (id: string) => docs.filter((d) => d.folder_id === id).length

  const move = useMutation({
    mutationFn: ({ ids, folder }: { ids: string[]; folder: string | null }) => moveDocuments(ids, folder),
    onSuccess: async (n, v) => {
      await queryClient.invalidateQueries({ queryKey: ['documents', p.id] })
      setPicked(new Set())
      setMoveOpen(false)
      toast.success(n === v.ids.length ? tr('Перенесено документов: {{n}}', { n }) : tr('Перенесено: {{n}} из {{length}} (остальные вы менять не вправе)', { n, length: v.ids.length }))
    },
    onError: (e) => toast.error(folderErrorText(e, tr('Не удалось перенести документы.'))),
  })
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // сравнение двух документов: у каждого берём действующую версию (а если её нет — последнюю, доступную пользователю)
  const compareSelected = () => {
    const [a, b] = [...picked].map((id) => docs.find((d) => d.id === id))
    const va = a?.current_version_id ?? a?.latest_version_id
    const vb = b?.current_version_id ?? b?.latest_version_id
    if (!va || !vb) {
      toast.error(tr('У одного из документов нет версии, которую можно сравнить.'))
      return
    }
    void navigate({ to: '/projects/$code/compare', params: { code }, search: { a: va, b: vb } })
  }
  const startDrag =(e: React.DragEvent, id: string) => {
    const ids = picked.has(id) ? [...picked] : [id]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
  }

  // поиск по тексту внутри файлов: запрос уходит на сервер после паузы в наборе
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 400)
    return () => clearTimeout(t)
  }, [query])
  const { data: hits } = useQuery(searchDocumentsQuery(p.id, debounced))
  const docById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="hidden max-w-prose text-sm text-muted-foreground sm:block">{tr('Планы, чертежи, договоры и другие документы проекта. У каждого есть версии, привязка к местам и направлению; о новой версии уведомляются те, кому она нужна.')}</p>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <ExportButton
            fileName={tr('Документы {{code}}', { code: p.code })}
            disabled={visible.length === 0}
            build={() => ({
              name: tr('Документы'),
              headers: [tr('Шифр'), tr('Название'), tr('Тип'), tr('Направление'), tr('Места'), tr('Ревизия'), tr('Выпущен'), tr('Версий'), tr('Видимость'), tr('Файл')],
              rows: visible.map((d) => [
                d.code ?? '',
                d.title,
                DOC_TYPE_LABELS[d.doc_type],
                d.discipline_id ? (disciplines.get(d.discipline_id)?.code ?? '') : '',
                d.location_paths.join(', '),
                d.current_revision ?? '',
                isoToDate(d.published_at),
                d.versions,
                d.visibility === 'external' ? tr('подрядчикам и заказчику') : tr('команде'),
                d.file_name ?? '',
              ]),
            })}
          />
          {canUpload && (
            <Button variant="outline" onClick={() => setFolderUpload(true)}>
              <FolderUp />{tr('Загрузить папку')}</Button>
          )}
          {canUpload && (
            <Button className="max-sm:order-first max-sm:h-12 max-sm:w-full" onClick={() => setUploading(true)}>
              <Plus />{tr('Загрузить документ')}</Button>
          )}
        </div>
      </div>

      {pendingAck > 0 && !search.ack && (
        <button
          type="button"
          onClick={() => setSearch({ ack: true })}
          className="flex min-h-12 items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 text-left text-sm"
        >
          <BellRing className="size-4 text-amber-800 dark:text-amber-300" aria-hidden />
          <span className="flex-1 font-medium">{tr('Ждут вашего ознакомления:')}{' '}{pendingAck}</span>
          <span className="text-muted-foreground">{tr('Показать')}</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label={tr('Поиск по названию, шифру и тексту документов')} placeholder={tr('Название, шифр или текст')} className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <MobileFilters activeCount={(search.disc ? 1 : 0) + (search.loc ? 1 : 0) + (type !== ALL ? 1 : 0)}>
        <Select value={search.disc ?? ALL} onValueChange={(v) => setSearch({ disc: v === ALL ? undefined : v })}>
          <SelectTrigger size="sm" aria-label={tr('Направление')} className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{tr('Все направления')}</SelectItem>
            {flattenDisciplines(disciplineRows).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span style={{ paddingLeft: d.depth * 12 }}>
                  <span className="ident text-muted-foreground">{d.code}</span> {d.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={search.loc ?? ALL} onValueChange={(v) => setSearch({ loc: v === ALL ? undefined : v })}>
          <SelectTrigger size="sm" aria-label={tr('Место')} className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL}>{tr('Вся площадка')}</SelectItem>
            {locationNodes
              .filter((n) => n.kind !== 'room')
              .map((n) => (
                <SelectItem key={n.id} value={n.path}>
                  <span style={{ paddingLeft: n.depth * 12 }}>
                    <span className="ident text-muted-foreground">{n.code}</span> {n.name}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" aria-label={tr('Тип документа')} className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{tr('Все типы')}</SelectItem>
            {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </MobileFilters>
        {search.ack && (
          <Button size="sm" variant="secondary" onClick={() => setSearch({ ack: undefined })}>{tr('Только ждущие ознакомления ✕')}</Button>
        )}
        <span className="text-sm text-muted-foreground">{tr('Документов:')}{' '}{visible.length}</span>
      </div>

      <div className={showPanel ? 'grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]' : ''}>
        {showPanel && (
          <aside className="hidden lg:block">
            <FolderPanel projectId={p.id} folders={folders} docs={docs} selected={selectedFolder} onSelect={selectFolder} canEdit={canUpload} canPublish={canPublish} />
          </aside>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          {showPanel && (
            <div className="lg:hidden">
              <Select value={selectedFolder} onValueChange={(v) => selectFolder(v as FolderSelection)}>
                <SelectTrigger size="sm" aria-label={tr('Папка')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">{tr('Все документы')}</SelectItem>
                  <SelectItem value="root">{tr('Без папки')}</SelectItem>
                  {folderFlat.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <span style={{ paddingLeft: f.depth * 12 }}>{f.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showPanel && !query.trim() && selectedFolder !== 'all' && (
            <div className="flex flex-col gap-2">
              <nav aria-label={tr('Путь')} className="flex flex-wrap items-center gap-1 text-sm">
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => selectFolder('all')}>{tr('Все документы')}</button>
                {selectedFolder === 'root' ? (
                  <>
                    <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="font-medium">{tr('Без папки')}</span>
                  </>
                ) : (
                  crumbs.map((c, i) => (
                    <span key={c.id} className="flex items-center gap-1">
                      <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                      {i === crumbs.length - 1 ? (
                        <span className="font-medium">{c.name}</span>
                      ) : (
                        <button type="button" className="text-muted-foreground hover:underline" onClick={() => selectFolder(c.id)}>
                          {c.name}
                        </button>
                      )}
                    </span>
                  ))
                )}
              </nav>
              {subfolders.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {subfolders.map((f) => (
                    <li key={f.id}>
                      <button type="button" onClick={() => selectFolder(f.id)} className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-soft hover:bg-muted/60">
                        <Folder className="size-4 text-muted-foreground" aria-hidden /> {f.name}
                        <span className="text-xs tabular-nums text-muted-foreground">{folderDocCount(f.id) || ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {showPanel && query.trim() && selectedFolder !== 'all' && <p className="text-xs text-muted-foreground">{tr('Идёт поиск по всем папкам.')}</p>}

          {picked.size > 0 && (
            <div role="region" aria-label={tr('Действия над выбранными документами')} className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 shadow-lg lg:top-[4.25rem]">
              <span className="text-sm font-medium">{tr('Выбрано:')}{' '}{picked.size}</span>
              {canUpload && (
                <Button size="sm" variant="secondary" onClick={() => setMoveOpen(true)}>
                  <FolderInput />{tr('Переместить в папку…')}</Button>
              )}
              <Button size="sm" variant="secondary" disabled={picked.size !== 2} onClick={compareSelected}>
                <GitCompareArrows />{tr('Сравнить')}</Button>
              {picked.size !== 2 && <span className="text-xs text-muted-foreground">{tr('Для сравнения отметьте ровно два документа: первый — «было», второй — «стало».')}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked(new Set())}>{tr('Снять выбор')}</Button>
            </div>
          )}

      {query.trim().length >= 3 && hits && hits.length > 0 && (
        <section className="flex flex-col gap-2" aria-label={tr('Найдено в тексте документов')}>
          <h2 className="text-sm font-semibold">{tr('Найдено в тексте документов:')}{' '}{hits.length}</h2>
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card shadow-soft">
            {hits.map((h) => {
              const d = docById.get(h.document_id)
              if (!d) return null
              return (
                <li key={h.version_id}>
                  <Link to="/projects/$code/plan/$id" params={{ code, id: d.id }} search={{ q: debounced.trim() }} className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/40">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {d.title}
                      {d.code && <span className="ident text-xs font-normal text-muted-foreground">{d.code}</span>}
                      {h.revision && <span className="ident rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{h.revision}</span>}
                    </span>
                    <Snippet text={h.snippet} />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {docs.length === 0
            ? canUpload
              ? tr('Документов пока нет. Загрузите первый: план этажа, схему, договор — и привяжите к месту и направлению.')
              : tr('Документов пока нет.')
            : tr('По этим условиям документов нет. Ослабьте фильтры.')}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((d) => (
              <li key={d.id}>
                <Link to="/projects/$code/plan/$id" params={{ code, id: d.id }} className="flex gap-3 rounded-lg border bg-card p-3 shadow-soft active:bg-muted">
                  <DocThumb d={d} canGenerate={canThumbs} className="h-20 w-16 self-start" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 font-medium">{d.title}</span>
                      <span className="ident shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{d.current_revision || d.latest_revision || '—'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {d.code && <span className="ident">{d.code}</span>}
                      <span>{DOC_TYPE_LABELS[d.doc_type]}</span>
                      {d.location_paths.length > 0 && <span className="ident">{d.location_paths.slice(0, 2).join(', ')}{d.location_paths.length > 2 ? ` +${d.location_paths.length - 2}` : ''}</span>}
                    </div>
                    <StatusBadge d={d} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="md:hidden">{more}</div>

          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-soft md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-9">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={tr('Выбрать все показанные')}
                      checked={visible.length > 0 && visible.every((d) => picked.has(d.id))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(visible.map((d) => d.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>{tr('Документ')}</TableHead>
                  <TableHead className="w-24">{tr('Тип')}</TableHead>
                  <TableHead className="w-20">{tr('Напр.')}</TableHead>
                  <TableHead className="hidden w-40 2xl:table-cell">{tr('Места')}</TableHead>
                  <TableHead className="w-28">{tr('Версия')}</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((d) => {
                  const disc = d.discipline_id ? disciplines.get(d.discipline_id) : null
                  return (
                    <TableRow key={d.id} className="relative" data-state={picked.has(d.id) ? 'selected' : undefined}>
                      <TableCell className="relative z-10 w-9">
                        <input type="checkbox" className="size-4" aria-label={tr('Выбрать: {{title}}', { title: d.title })} checked={picked.has(d.id)} onChange={() => togglePick(d.id)} />
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="flex items-start gap-3">
                          <Link to="/projects/$code/plan/$id" params={{ code, id: d.id }} tabIndex={-1} aria-hidden className="relative z-10 shrink-0">
                            <DocThumb d={d} canGenerate={canThumbs} className="h-14 w-11" />
                          </Link>
                          <span className="min-w-0">
                        <Link
                          to="/projects/$code/plan/$id"
                          params={{ code, id: d.id }}
                          draggable={canUpload}
                          onDragStart={(e) => startDrag(e, d.id)}
                          className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-offset-[-2px]"
                        >
                          {d.title}
                        </Link>
                        {d.code && <span className="ident mt-0.5 block text-xs text-muted-foreground">{d.code}</span>}
                        {d.folder_id && (selectedFolder === 'all' || query.trim()) && folderById.get(d.folder_id) && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Folder className="size-3" aria-hidden /> {folderById.get(d.folder_id)!.path}
                          </span>
                        )}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{DOC_TYPE_LABELS[d.doc_type]}</TableCell>
                      <TableCell>
                        {disc ? (
                          <span className={`ident rounded px-1.5 py-0.5 font-medium ${(disc.color && DISCIPLINE_STYLES[disc.color]) || DEFAULT_DISCIPLINE_STYLE}`}>{disc.code}</span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground 2xl:table-cell">
                        {d.location_paths.length === 0 ? '—' : (
                          <span className="ident">
                            {d.location_paths.slice(0, 2).join(', ')}
                            {d.location_paths.length > 2 ? ` +${d.location_paths.length - 2}` : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {d.current_version_id ? (
                          <>
                            <span className="ident font-medium">{d.current_revision || `№${d.current_version_no}`}</span>
                            <span className="block text-xs text-muted-foreground">{d.published_at ? dateFmt.format(new Date(d.published_at)) : ''}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{tr('не выпущен')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge d={d} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <div className="hidden md:flex md:justify-center">{more}</div>
        </>
      )}

        </div>
      </div>

      {moveOpen && (
        <FolderPickerDialog
          title={tr('Переместить документов: {{size}}', { size: picked.size })}
          description={tr('Выберите папку. Документы, которые вы менять не вправе, останутся на месте.')}
          folders={folders}
          busy={move.isPending}
          onClose={() => setMoveOpen(false)}
          onPick={(folder) => move.mutate({ ids: [...picked], folder })}
        />
      )}
      {uploading && <UploadDocumentDialog projectId={p.id} presetFolderId={realFolderId} onClose={() => setUploading(false)} />}
      {folderUpload && <BulkUploadDialog projectId={p.id} baseFolderId={realFolderId} onClose={() => setFolderUpload(false)} />}
    </div>
  )
}
