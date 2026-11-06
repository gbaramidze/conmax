import { tr } from '@/lib/tr'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Folder, FolderInput, FolderOpen, FolderPlus, Layers, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/features/auth/auth-provider'
import type { DocumentRow } from '@/features/documents/api'
import {
  buildFolderTree,
  createFolder,
  deleteFolder,
  DRAG_TYPE,
  folderErrorText,
  moveDocuments,
  moveFolder,
  renameFolder,
  subtreeIds,
  type FolderNode,
  type FolderRow,
} from '@/features/documents/folders-api'

export type FolderSelection = 'all' | 'root' | string

// ---------------------------------------------------------------------------
// Небольшие диалоги
// ---------------------------------------------------------------------------
function NameDialog({ title, description, initial, submitLabel, busy, onSubmit, onClose }: {
  title: string
  description?: string
  initial: string
  submitLabel: string
  busy: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !busy) onSubmit(name.trim())
          }}
        >
          <Input aria-label={tr('Название папки')} value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy ? tr('Сохраняем…') : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Выбор папки списком с отступами. `disabled` — папки, которые выбрать нельзя (например, сама перемещаемая и её вложенные). */
export function FolderPickerDialog({ title, description, folders, disabled = [], allowRoot = true, busy = false, onPick, onClose }: {
  title: string
  description?: string
  folders: FolderRow[]
  disabled?: string[]
  allowRoot?: boolean
  busy?: boolean
  onPick: (folderId: string | null) => void
  onClose: () => void
}) {
  const { flat } = useMemo(() => buildFolderTree(folders), [folders])
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ul className="max-h-80 overflow-y-auto rounded-lg border">
          {allowRoot && (
            <li>
              <button type="button" disabled={busy} onClick={() => onPick(null)} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted/60 disabled:opacity-50">
                <Layers className="size-4 text-muted-foreground" aria-hidden />{tr('Без папки (корень)')}</button>
            </li>
          )}
          {flat.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={busy || disabled.includes(f.id)}
                onClick={() => onPick(f.id)}
                className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ paddingLeft: 12 + f.depth * 16 }}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
          {flat.length === 0 && !allowRoot && <li className="px-3 py-4 text-sm text-muted-foreground">{tr('Папок пока нет.')}</li>}
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Панель папок
// ---------------------------------------------------------------------------
type Dlg = { type: 'create'; parent: string | null } | { type: 'rename'; node: FolderNode } | { type: 'move'; node: FolderNode } | { type: 'delete'; node: FolderNode } | null

/**
 * Дерево папок проекта: выбор, создание, переименование, перенос, удаление, а также перетаскивание документов в папку.
 * «Все документы» — плоский список целиком; «Без папки» — то, что лежит в корне.
 */
export function FolderPanel({ projectId, folders, docs, selected, onSelect, canEdit, canPublish }: {
  projectId: string
  folders: FolderRow[]
  docs: DocumentRow[]
  selected: FolderSelection
  onSelect: (s: FolderSelection) => void
  canEdit: boolean
  canPublish: boolean
}) {
  const queryClient = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user.id
  const { roots, byId } = useMemo(() => buildFolderTree(folders), [folders])
  const [dlg, setDlg] = useState<Dlg>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  const storeKey = `doc-folders-open:${projectId}`
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]))
      } catch {
        /* хранилище недоступно — раскрытые папки не запомнятся */
      }
      return next
    })

  // выбранная папка всегда раскрыта вместе с предками
  const expanded = useMemo(() => {
    const s = new Set(open)
    if (selected !== 'all' && selected !== 'root') s.add(selected)
    let cur = selected !== 'all' && selected !== 'root' ? byId.get(selected) : undefined
    while (cur?.parent_id) {
      s.add(cur.parent_id)
      cur = byId.get(cur.parent_id)
    }
    return s
  }, [open, selected, byId])

  const direct = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of docs) if (d.folder_id) m.set(d.folder_id, (m.get(d.folder_id) ?? 0) + 1)
    return m
  }, [docs])
  const total = (n: FolderNode): number => (direct.get(n.id) ?? 0) + n.children.reduce((s, c) => s + total(c), 0)
  const rootCount = docs.filter((d) => !d.folder_id).length

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['document-folders', projectId] }), queryClient.invalidateQueries({ queryKey: ['documents', projectId] })])
  const run = useMutation({
    mutationFn: async (job: () => Promise<unknown>) => job(),
    onSuccess: async () => {
      await refresh()
      setDlg(null)
    },
    onError: (e) => toast.error(folderErrorText(e, tr('Не удалось сохранить. Попробуйте ещё раз.'))),
  })

  function drop(e: React.DragEvent, folderId: string | null) {
    e.preventDefault()
    setDropOn(null)
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw || !canEdit) return
    const ids = JSON.parse(raw) as string[]
    run.mutate(async () => {
      const n = await moveDocuments(ids, folderId)
      const name = folderId ? (byId.get(folderId)?.name ?? tr('папку')) : tr('корень')
      toast.success(n === ids.length ? tr('Перенесено в «{{name}}»: {{n}}', { name, n }) : tr('Перенесено: {{n}} из {{length}} (остальные вы менять не вправе)', { n, length: ids.length }))
    })
  }
  const dropProps = (key: string, folderId: string | null) =>
    canEdit
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault()
              setDropOn(key)
            }
          },
          onDragLeave: () => setDropOn((cur) => (cur === key ? null : cur)),
          onDrop: (e: React.DragEvent) => drop(e, folderId),
        }
      : {}

  const row = 'group flex min-h-8 items-center gap-1 rounded-md pr-1 text-sm'
  const pick = (active: boolean) => `${active ? 'bg-secondary font-medium' : 'hover:bg-muted/60'}`

  function renderNode(n: FolderNode) {
    const isOpen = expanded.has(n.id)
    const active = selected === n.id
    const canDelete = canPublish || n.created_by === uid
    return (
      <li key={n.id}>
        <div className={`${row} ${pick(active)} ${dropOn === n.id ? 'bg-signal/30 ring-1 ring-signal' : ''}`} {...dropProps(n.id, n.id)}>
          <button
            type="button"
            aria-label={isOpen ? tr('Свернуть') : tr('Развернуть')}
            aria-expanded={n.children.length > 0 ? isOpen : undefined}
            className={`grid size-6 shrink-0 place-items-center rounded hover:bg-muted ${n.children.length === 0 ? 'invisible' : ''}`}
            style={{ marginLeft: n.depth * 14 }}
            onClick={() => toggle(n.id)}
          >
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <button type="button" aria-current={active ? 'true' : undefined} onClick={() => onSelect(n.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {isOpen && n.children.length > 0 ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="truncate">{n.name}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{total(n) || ''}</span>
          </button>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={tr('Действия с папкой «{{name}}»', { name: n.name })} className="grid size-7 shrink-0 place-items-center rounded opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100">
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => setDlg({ type: 'create', parent: n.id })}>
                  <FolderPlus />{tr('Новая подпапка')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDlg({ type: 'rename', node: n })}>
                  <Pencil />{tr('Переименовать')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDlg({ type: 'move', node: n })}>
                  <FolderInput />{tr('Переместить в…')}</DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setDlg({ type: 'delete', node: n })}>
                      <Trash2 />{tr('Удалить папку')}</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {isOpen && n.children.length > 0 && <ul>{n.children.map(renderNode)}</ul>}
      </li>
    )
  }

  return (
    <nav aria-label={tr('Папки документов')} className="flex flex-col gap-1 rounded-lg border bg-card p-2 shadow-soft">
      <div className="flex items-center justify-between px-1.5 py-1">
        <h2 className="text-sm font-semibold">{tr('Папки')}</h2>
        {canEdit && (
          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={tr('Новая папка')} title={tr('Новая папка')} onClick={() => setDlg({ type: 'create', parent: selected !== 'all' && selected !== 'root' ? selected : null })}>
            <FolderPlus />
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-0.5">
        <li>
          <button type="button" aria-current={selected === 'all' ? 'true' : undefined} onClick={() => onSelect('all')} className={`${row} ${pick(selected === 'all')} w-full px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{tr('Все документы')}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{docs.length}</span>
          </button>
        </li>
        <li {...dropProps('root', null)}>
          <button type="button" aria-current={selected === 'root' ? 'true' : undefined} onClick={() => onSelect('root')} className={`${row} ${pick(selected === 'root')} ${dropOn === 'root' ? 'bg-signal/30 ring-1 ring-signal' : ''} w-full px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{tr('Без папки')}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{rootCount || ''}</span>
          </button>
        </li>
        {roots.map(renderNode)}
      </ul>

      {folders.length === 0 && (
        <p className="px-2 pb-1 pt-2 text-xs text-muted-foreground">{canEdit ? tr('Папок пока нет. Создайте первую кнопкой «+» или загрузите папку целиком.') : tr('Папок пока нет.')}</p>
      )}

      {dlg?.type === 'create' && (
        <NameDialog
          title={tr('Новая папка')}
          description={dlg.parent ? tr('Внутри «{{v1}}»', { v1: byId.get(dlg.parent)?.name ?? '' }) : tr('В корне проекта')}
          initial=""
          submitLabel={tr('Создать')}
          busy={run.isPending}
          onClose={() => setDlg(null)}
          onSubmit={(name) =>
            run.mutate(async () => {
              const id = await createFolder(projectId, dlg.parent, name)
              if (dlg.parent) setOpen((prev) => new Set(prev).add(dlg.parent!))
              onSelect(id)
            })
          }
        />
      )}
      {dlg?.type === 'rename' && (
        <NameDialog title={tr('Переименовать папку')} initial={dlg.node.name} submitLabel={tr('Сохранить')} busy={run.isPending} onClose={() => setDlg(null)} onSubmit={(name) => run.mutate(() => renameFolder(dlg.node.id, name))} />
      )}
      {dlg?.type === 'move' && (
        <FolderPickerDialog
          title={tr('Переместить «{{name}}»', { name: dlg.node.name })}
          description={tr('Выберите, куда поместить папку вместе с содержимым.')}
          folders={folders}
          disabled={subtreeIds(dlg.node)}
          busy={run.isPending}
          onClose={() => setDlg(null)}
          onPick={(parent) => run.mutate(() => moveFolder(dlg.node.id, parent))}
        />
      )}
      {dlg?.type === 'delete' && (
        <Dialog open onOpenChange={(o) => !o && !run.isPending && setDlg(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{tr('Удалить папку «')}{dlg.node.name}»?</DialogTitle>
              <DialogDescription>{tr('Документы и вложенные папки не удаляются: они поднимутся на уровень выше.')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" disabled={run.isPending} onClick={() => setDlg(null)}>{tr('Отмена')}</Button>
              <Button
                variant="destructive"
                disabled={run.isPending}
                onClick={() =>
                  run.mutate(async () => {
                    await deleteFolder(dlg.node.id)
                    if (selected === dlg.node.id) onSelect(dlg.node.parent_id ?? 'all')
                  })
                }
              >{tr('Удалить папку')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </nav>
  )
}
