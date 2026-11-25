import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { DocThumb } from '@/features/documents/doc-thumb'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BellRing, CheckCheck, Download, ExternalLink, Folder, FolderInput, FolderOpen, FolderPlus, FolderUp, GitCompareArrows, LayoutGrid, List, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useAuth } from '@/features/auth/auth-provider'
import { DeleteItemsDialog, DocTile, FolderTile, folderKey, isFolderKey, keyFromEvent, PathBar, useDocView, type DocView } from '@/features/documents/explorer'
import { downloadFile } from '@/features/plans/api'
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
import { DOC_TYPE_LABELS, documentsQuery, searchDocumentsQuery, updateDocument, type DocumentRow } from '@/features/documents/api'
import { BulkUploadDialog } from '@/features/documents/bulk-upload-dialog'
import { FolderDialogs, FolderPanel, FolderPickerDialog, NameDialog, type FolderDlg, type FolderSelection } from '@/features/documents/folder-panel'
import { buildFolderTree, deleteFolder, DRAG_TYPE, folderErrorText, foldersQuery, moveDocuments, moveFolder, subtreeIds } from '@/features/documents/folders-api'
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
  const { session } = useAuth()
  const uid = session?.user.id
  const canEditDoc = (d: DocumentRow) => canPublish || d.created_by === uid
  const canDeleteFolder = (f: { created_by: string | null }) => canUpload && (canPublish || f.created_by === uid)
  const [view, setView] = useDocView()
  // выделение: id документов и folderKey(id) папок
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const pointerType = useRef<string>('mouse')
  const menuKey = useRef<string | null>(null)
  const [menuOn, setMenuOn] = useState<'items' | 'blank'>('blank')
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renaming, setRenaming] = useState<DocumentRow | null>(null)
  const [folderDlg, setFolderDlg] = useState<FolderDlg>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  const disciplines = useMemo(() => new Map(disciplineRows.map((d) => [d.id, d])), [disciplineRows])
  const docById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])
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

  // Вид «Значки» — как проводник: наверху папки верхнего уровня и документы без папки, внутри папки — её подпапки и документы.
  // Пока что-то ищут или отфильтровано, папки не показываются, а документы — все подходящие (как результаты поиска в проводнике).
  const filtering = !!query.trim() || !!search.disc || !!search.loc || type !== ALL || !!search.ack
  const iconsTop = selectedFolder === 'all' || selectedFolder === 'root'
  const { roots: rootFolders } = useMemo(() => buildFolderTree(folders), [folders])
  const iconFolders = view !== 'icons' || filtering ? [] : realFolderId ? (folderById.get(realFolderId)?.children ?? []) : rootFolders
  const iconDocs = useMemo(() => {
    const list = view === 'icons' && !filtering && iconsTop ? visible.filter((d) => !d.folder_id) : visible
    return view === 'icons' ? [...list].sort((a, b) => a.title.localeCompare(b.title, currentLocale(), { numeric: true })) : list
  }, [view, filtering, iconsTop, visible])
  const { shown, more } = useShowMore(iconDocs, view === 'icons' ? 60 : 40, `${view}|${selectedFolder}|${query}|${search.disc}|${search.loc}|${type}|${search.ack}`)

  const pendingAck = docs.filter((d) => d.ack_pending).length

  const selectFolder = (f: FolderSelection) => {
    setPicked(new Set())
    anchor.current = null
    setSearch({ folder: f === 'all' ? undefined : f })
  }
  const crumbs = realFolderId ? (() => {
    const out = []
    for (let cur = folderById.get(realFolderId); cur; cur = cur.parent_id ? folderById.get(cur.parent_id) : undefined) out.unshift(cur)
    return out
  })() : []
  const subfolders = realFolderId ? (folderById.get(realFolderId)?.children ?? []) : []
  const folderDocCount = (id: string) => docs.filter((d) => d.folder_id === id).length
  const folderTotals = useMemo(() => {
    const direct = new Map<string, number>()
    for (const d of docs) if (d.folder_id) direct.set(d.folder_id, (direct.get(d.folder_id) ?? 0) + 1)
    const total = new Map<string, number>()
    const walk = (id: string): number => {
      const node = folderById.get(id)
      const n = (direct.get(id) ?? 0) + (node?.children.reduce((s, c) => s + walk(c.id), 0) ?? 0)
      total.set(id, n)
      return n
    }
    for (const r of rootFolders) walk(r.id)
    return total
  }, [docs, folderById, rootFolders])
  const upTarget: FolderSelection | null = realFolderId ? (folderById.get(realFolderId)?.parent_id ?? 'all') : selectedFolder === 'root' && view === 'table' ? 'all' : null

  // ---- выделение ----
  const pickedDocs = [...picked].filter((k) => !isFolderKey(k)).map((id) => docById.get(id)).filter((d): d is DocumentRow => !!d)
  const pickedFolders = [...picked].filter(isFolderKey).map((k) => folderById.get(k.slice(2))).filter((f) => !!f)
  // порядок элементов на экране — для выделения диапазона с Shift
  const order = [...iconFolders.map((f) => folderKey(f.id)), ...shown.map((d) => d.id)]
  const togglePick = (id: string) => {
    anchor.current = id
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearPicked = () => {
    setPicked(new Set())
    anchor.current = null
  }
  /** Клик как в проводнике: просто клик — выделить одно, Ctrl/⌘ — добавить или снять, Shift — диапазон. На сенсорном экране касание открывает, а в режиме выбора — отмечает. */
  const clickItem = (e: React.MouseEvent, key: string, open: () => void) => {
    const touch = pointerType.current !== 'mouse'
    if (touch && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      if (picked.size > 0) togglePick(key)
      else open()
      return
    }
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(key)].sort((x, y) => x - y)
      const range = order.slice(a, b + 1)
      setPicked((prev) => new Set(e.ctrlKey || e.metaKey ? [...prev, ...range] : range))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      togglePick(key)
      return
    }
    anchor.current = key
    setPicked(new Set([key]))
  }
  const openDocById = (id: string) => void navigate({ to: '/projects/$code/plan/$id', params: { code, id } })

  // Правый клик (или долгое касание): по невыделенному элементу — выделить только его, по пустому месту — снять выделение.
  const onMenuOpenChange = (open: boolean) => {
    if (!open) return
    const key = menuKey.current
    if (key) {
      if (!picked.has(key)) {
        anchor.current = key
        setPicked(new Set([key]))
      }
      setMenuOn('items')
    } else {
      clearPicked()
      setMenuOn('blank')
    }
  }

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['documents', p.id] }), queryClient.invalidateQueries({ queryKey: ['document-folders', p.id] })])
  const move = useMutation({
    mutationFn: async ({ docIds, folderIds, folder }: { docIds: string[]; folderIds: string[]; folder: string | null }) => {
      let n = docIds.length > 0 ? await moveDocuments(docIds, folder) : 0
      for (const id of folderIds) {
        await moveFolder(id, folder)
        n++
      }
      return n
    },
    onSuccess: async (n, v) => {
      await refresh()
      clearPicked()
      setMoveOpen(false)
      const length = v.docIds.length + v.folderIds.length
      toast.success(n === length ? tr('Перенесено: {{n}}', { n }) : tr('Перенесено: {{n}} из {{length}} (остальные вы менять не вправе)', { n, length }))
    },
    onError: async (e) => {
      await refresh()
      toast.error(folderErrorText(e, tr('Не удалось перенести документы.')))
    },
  })
  const deletableDocs = pickedDocs.filter(canEditDoc)
  const deletableFolders = pickedFolders.filter(canDeleteFolder)
  const remove = useMutation({
    mutationFn: async () => {
      let n = 0
      for (const d of deletableDocs) {
        await updateDocument(d.id, { deleted_at: new Date().toISOString() })
        n++
      }
      for (const f of deletableFolders) {
        await deleteFolder(f.id)
        n++
      }
      return n
    },
    onSuccess: async (n) => {
      await refresh()
      clearPicked()
      setDeleteOpen(false)
      toast.success(tr('Удалено: {{n}}', { n }))
    },
    onError: async () => {
      await refresh()
      toast.error(tr('Удалить удалось не всё. Обновите страницу и попробуйте ещё раз.'))
    },
  })
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => updateDocument(id, { title }),
    onSuccess: async () => {
      await refresh()
      setRenaming(null)
    },
    onError: () => toast.error(tr('Не удалось переименовать документ.')),
  })
  const download = async (list: DocumentRow[]) => {
    for (const d of list) {
      if (!d.storage_key) continue
      try {
        await downloadFile(d.storage_key, d.file_name)
      } catch {
        toast.error(tr('Не удалось скачать «{{title}}».', { title: d.title }))
      }
    }
  }
  // сравнение двух документов: у каждого берём действующую версию (а если её нет — последнюю, доступную пользователю)
  const compareSelected = () => {
    const [a, b] = pickedDocs
    const va = a?.current_version_id ?? a?.latest_version_id
    const vb = b?.current_version_id ?? b?.latest_version_id
    if (!va || !vb) {
      toast.error(tr('У одного из документов нет версии, которую можно сравнить.'))
      return
    }
    void navigate({ to: '/projects/$code/compare', params: { code }, search: { a: va, b: vb } })
  }
  const canCompare = pickedDocs.length === 2 && pickedFolders.length === 0
  const startDrag = (e: React.DragEvent, id: string) => {
    const ids = picked.has(id) ? pickedDocs.map((d) => d.id) : [id]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
  }
  // документы можно бросить на плитку папки
  const folderDropProps = (folderId: string): React.HTMLAttributes<HTMLDivElement> =>
    canUpload
      ? {
          onDragOver: (e) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault()
              setDropOn(folderId)
            }
          },
          onDragLeave: () => setDropOn((cur) => (cur === folderId ? null : cur)),
          onDrop: (e) => {
            e.preventDefault()
            setDropOn(null)
            const raw = e.dataTransfer.getData(DRAG_TYPE)
            if (raw) move.mutate({ docIds: JSON.parse(raw) as string[], folderIds: [], folder: folderId })
          },
        }
      : {}

  // поиск по тексту внутри файлов: запрос уходит на сервер после паузы в наборе
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 400)
    return () => clearTimeout(t)
  }, [query])
  const { data: hits } = useQuery(searchDocumentsQuery(p.id, debounced))

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

          <PathBar
            crumbs={crumbs}
            extra={view === 'table' && selectedFolder === 'root' ? tr('Без папки') : undefined}
            onRoot={() => selectFolder('all')}
            onCrumb={(id) => selectFolder(id)}
            onUp={upTarget ? () => selectFolder(upTarget) : undefined}
            onNewFolder={canUpload ? () => setFolderDlg({ type: 'create', parent: realFolderId }) : undefined}
            view={view}
            onView={(v) => {
              clearPicked()
              setView(v)
            }}
          />
          {view === 'table' && !query.trim() && subfolders.length > 0 && (
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
          {showPanel && query.trim() && selectedFolder !== 'all' && <p className="text-xs text-muted-foreground">{tr('Идёт поиск по всем папкам.')}</p>}

          {picked.size > 0 && (
            <div role="region" aria-label={tr('Действия над выбранными документами')} className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 shadow-lg lg:top-[4.25rem]">
              <span className="text-sm font-medium">{tr('Выбрано:')}{' '}{picked.size}</span>
              {canUpload && (
                <Button size="sm" variant="secondary" onClick={() => setMoveOpen(true)}>
                  <FolderInput />{tr('Переместить в папку…')}</Button>
              )}
              <Button size="sm" variant="secondary" disabled={!canCompare} onClick={compareSelected}>
                <GitCompareArrows />{tr('Сравнить')}</Button>
              {deletableDocs.length + deletableFolders.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setDeleteOpen(true)}>
                  <Trash2 />{tr('Удалить')}</Button>
              )}
              {!canCompare && pickedFolders.length === 0 && <span className="text-xs text-muted-foreground">{tr('Для сравнения отметьте ровно два документа: первый — «было», второй — «стало».')}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={clearPicked}>{tr('Снять выбор')}</Button>
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

      <ContextMenu onOpenChange={onMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <div
            className="flex min-h-64 flex-col gap-4"
            onPointerDown={(e) => {
              pointerType.current = e.pointerType
              menuKey.current = keyFromEvent(e)
            }}
            onContextMenu={(e) => {
              menuKey.current = keyFromEvent(e)
            }}
            onClick={(e) => {
              // клик по пустому месту снимает выделение, как в проводнике
              if (view === 'icons' && e.target instanceof Element && !e.target.closest('[data-key], button, a, input')) clearPicked()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && picked.size > 0) clearPicked()
            }}
          >
      {iconFolders.length === 0 && iconDocs.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-soft">
          {docs.length === 0 && folders.length === 0
            ? canUpload
              ? tr('Документов пока нет. Загрузите первый: план этажа, схему, договор — и привяжите к месту и направлению.')
              : tr('Документов пока нет.')
            : filtering
              ? tr('По этим условиям документов нет. Ослабьте фильтры.')
              : canUpload
                ? tr('Здесь пусто. Загрузите документ или создайте папку — кнопками сверху или правой кнопкой мыши.')
                : tr('Здесь пусто.')}
        </div>
      ) : view === 'icons' ? (
        <>
          <div
            role="listbox"
            aria-multiselectable
            aria-label={tr('Папки и документы')}
            className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
          >
            {iconFolders.map((f) => (
              <FolderTile
                key={f.id}
                node={f}
                count={folderTotals.get(f.id) ?? 0}
                dropActive={dropOn === f.id}
                dropProps={folderDropProps(f.id)}
                selected={picked.has(folderKey(f.id))}
                onClick={(e) => clickItem(e, folderKey(f.id), () => selectFolder(f.id))}
                onOpen={() => selectFolder(f.id)}
                onToggle={() => togglePick(folderKey(f.id))}
              />
            ))}
            {shown.map((d) => (
              <DocTile
                key={d.id}
                d={d}
                folderPath={filtering && d.folder_id && d.folder_id !== realFolderId ? folderById.get(d.folder_id)?.path : undefined}
                canThumbs={canThumbs}
                draggable={canUpload}
                onDragStart={(e) => startDrag(e, d.id)}
                selected={picked.has(d.id)}
                onClick={(e) => clickItem(e, d.id, () => openDocById(d.id))}
                onOpen={() => openDocById(d.id)}
                onToggle={() => togglePick(d.id)}
              />
            ))}
          </div>
          <div className="flex justify-center">{more}</div>
        </>
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((d) => (
              <li key={d.id} data-key={d.id}>
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
                    <TableRow key={d.id} data-key={d.id} className="relative" data-state={picked.has(d.id) ? 'selected' : undefined}>
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {menuOn === 'items' && picked.size > 0 ? (
            <>
              {picked.size === 1 && pickedFolders[0] && (
                <ContextMenuItem onSelect={() => selectFolder(pickedFolders[0].id)}>
                  <FolderOpen />{tr('Открыть')}</ContextMenuItem>
              )}
              {picked.size === 1 && pickedDocs[0] && (
                <>
                  <ContextMenuItem onSelect={() => openDocById(pickedDocs[0].id)}>
                    <FolderOpen />{tr('Открыть')}</ContextMenuItem>
                  <ContextMenuItem asChild>
                    <Link to="/projects/$code/plan/$id" params={{ code, id: pickedDocs[0].id }} target="_blank" rel="noopener">
                      <ExternalLink />{tr('Открыть в новой вкладке')}</Link>
                  </ContextMenuItem>
                </>
              )}
              {pickedFolders.length === 0 && pickedDocs.some((d) => d.storage_key) && (
                <ContextMenuItem onSelect={() => void download(pickedDocs)}>
                  <Download />
                  {pickedDocs.length > 1 ? tr('Скачать ({{n}})', { n: pickedDocs.length }) : tr('Скачать')}
                </ContextMenuItem>
              )}
              {canCompare && (
                <ContextMenuItem onSelect={compareSelected}>
                  <GitCompareArrows />{tr('Сравнить')}</ContextMenuItem>
              )}
              {(canUpload || (picked.size === 1 && pickedDocs[0] && canEditDoc(pickedDocs[0]))) && <ContextMenuSeparator />}
              {picked.size === 1 && pickedFolders[0] && canUpload && (
                <ContextMenuItem onSelect={() => setFolderDlg({ type: 'create', parent: pickedFolders[0].id })}>
                  <FolderPlus />{tr('Новая подпапка')}</ContextMenuItem>
              )}
              {picked.size === 1 && pickedFolders[0] && canUpload && (
                <ContextMenuItem onSelect={() => setFolderDlg({ type: 'rename', node: pickedFolders[0] })}>
                  <Pencil />{tr('Переименовать')}</ContextMenuItem>
              )}
              {picked.size === 1 && pickedDocs[0] && canEditDoc(pickedDocs[0]) && (
                <ContextMenuItem onSelect={() => setRenaming(pickedDocs[0])}>
                  <Pencil />{tr('Переименовать')}</ContextMenuItem>
              )}
              {canUpload && (
                <ContextMenuItem onSelect={() => setMoveOpen(true)}>
                  <FolderInput />{tr('Переместить в папку…')}</ContextMenuItem>
              )}
              {deletableDocs.length + deletableFolders.length > 0 && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 />
                    {picked.size > 1 ? tr('Удалить ({{n}})', { n: deletableDocs.length + deletableFolders.length }) : tr('Удалить')}
                  </ContextMenuItem>
                </>
              )}
            </>
          ) : (
            <>
              {canUpload && (
                <>
                  <ContextMenuItem onSelect={() => setFolderDlg({ type: 'create', parent: realFolderId })}>
                    <FolderPlus />{tr('Новая папка')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => setUploading(true)}>
                    <Upload />{tr('Загрузить документ')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => setFolderUpload(true)}>
                    <FolderUp />{tr('Загрузить папку')}</ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuRadioGroup
                value={view}
                onValueChange={(v) => {
                  clearPicked()
                  setView(v as DocView)
                }}
              >
                <ContextMenuRadioItem value="icons">
                  <LayoutGrid />{tr('Значки')}</ContextMenuRadioItem>
                <ContextMenuRadioItem value="table">
                  <List />{tr('Таблица')}</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
              {order.length > 0 && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={() => setPicked(new Set(order))}>
                    <CheckCheck />{tr('Выделить всё')}</ContextMenuItem>
                </>
              )}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

        </div>
      </div>

      {moveOpen && (
        <FolderPickerDialog
          title={pickedFolders.length > 0 ? tr('Переместить выбранное: {{size}}', { size: picked.size }) : tr('Переместить документов: {{size}}', { size: picked.size })}
          description={tr('Выберите папку. Документы, которые вы менять не вправе, останутся на месте.')}
          folders={folders}
          disabled={pickedFolders.flatMap(subtreeIds)}
          busy={move.isPending}
          onClose={() => setMoveOpen(false)}
          onPick={(folder) => move.mutate({ docIds: pickedDocs.map((d) => d.id), folderIds: pickedFolders.map((f) => f.id), folder })}
        />
      )}
      {deleteOpen && (
        <DeleteItemsDialog
          docs={deletableDocs.length}
          folders={deletableFolders.length}
          skipped={picked.size - deletableDocs.length - deletableFolders.length}
          busy={remove.isPending}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
      {renaming && (
        <NameDialog
          title={tr('Переименовать документ')}
          label={tr('Название документа')}
          maxLength={300}
          initial={renaming.title}
          submitLabel={tr('Сохранить')}
          busy={rename.isPending}
          onClose={() => setRenaming(null)}
          onSubmit={(title) => rename.mutate({ id: renaming.id, title })}
        />
      )}
      <FolderDialogs
        projectId={p.id}
        folders={folders}
        dlg={folderDlg}
        onClose={() => setFolderDlg(null)}
        onCreated={(id) => {
          anchor.current = folderKey(id)
          setPicked(new Set([folderKey(id)]))
        }}
        onDeleted={(node) => realFolderId === node.id && selectFolder(node.parent_id ?? 'all')}
      />
      {uploading && <UploadDocumentDialog projectId={p.id} presetFolderId={realFolderId} onClose={() => setUploading(false)} />}
      {folderUpload && <BulkUploadDialog projectId={p.id} baseFolderId={realFolderId} onClose={() => setFolderUpload(false)} />}
    </div>
  )
}
