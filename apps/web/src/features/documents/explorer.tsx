import { tr } from '@/lib/tr'
import { useCanGoBack, useRouter } from '@tanstack/react-router'
import { ArrowLeft, ArrowUp, BellRing, ChevronRight, Folder, FolderPlus, LayoutGrid, List } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DOC_TYPE_LABELS, type DocumentRow } from '@/features/documents/api'
import { DocThumb } from '@/features/documents/doc-thumb'
import type { FolderNode } from '@/features/documents/folders-api'
import { cn } from '@/lib/utils'

// Вид страницы документов «как в проводнике»: плитки папок и файлов, выделение мышью, контекстное меню.

export type DocView = 'icons' | 'table'
const VIEW_KEY = 'doc-view'

/** Выбранный вид запоминается в браузере: кто привык к таблице, так её и увидит. */
export function useDocView(): [DocView, (v: DocView) => void] {
  const [view, setView] = useState<DocView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'icons'
    } catch {
      return 'icons'
    }
  })
  const set = (v: DocView) => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* хранилище недоступно — вид не запомнится */
    }
  }
  return [view, set]
}

/** Ключ элемента в выделении: у документа — его id, у папки — «f:» и id (id не пересекаются, но так видно, что это папка). */
export const folderKey = (id: string) => `f:${id}`
export const isFolderKey = (key: string) => key.startsWith('f:')

/** Элемент под курсором: плитка или строка таблицы помечены data-key. */
export const keyFromEvent = (e: { target: EventTarget | null }) => (e.target instanceof Element ? (e.target.closest<HTMLElement>('[data-key]')?.dataset.key ?? null) : null)

// ---------------------------------------------------------------------------
// Строка пути: назад, вверх, папки, новая папка, переключатель вида
// ---------------------------------------------------------------------------
export function PathBar({ crumbs, extra, onRoot, onCrumb, onUp, onNewFolder, view, onView }: {
  /** папки от верхней до текущей */
  crumbs: FolderNode[]
  /** последний шаг пути, который не папка (например, «Без папки» в таблице) */
  extra?: string
  onRoot: () => void
  onCrumb: (id: string) => void
  /** нет — уже наверху */
  onUp?: () => void
  onNewFolder?: () => void
  view: DocView
  onView: (v: DocView) => void
}) {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const atRoot = crumbs.length === 0 && !extra
  return (
    <div className="flex min-h-11 items-center gap-1 rounded-lg border bg-card px-1.5 py-1 shadow-soft">
      <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label={tr('Назад')} title={tr('Назад')} disabled={!canGoBack} onClick={() => router.history.back()}>
        <ArrowLeft />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label={tr('На уровень выше')} title={tr('На уровень выше')} disabled={!onUp} onClick={onUp}>
        <ArrowUp />
      </Button>
      <nav aria-label={tr('Путь')} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap text-sm [scrollbar-width:none]">
        {atRoot ? (
          <span className="shrink-0 px-1.5 font-medium">{tr('Документы')}</span>
        ) : (
          <button type="button" className="shrink-0 rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onRoot}>
            {tr('Документы')}
          </button>
        )}
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
            {i === crumbs.length - 1 && !extra ? (
              <span className="px-1.5 font-medium" aria-current="page">{c.name}</span>
            ) : (
              <button type="button" className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onCrumb(c.id)}>
                {c.name}
              </button>
            )}
          </span>
        ))}
        {extra && (
          <span className="flex shrink-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="px-1.5 font-medium" aria-current="page">{extra}</span>
          </span>
        )}
      </nav>
      {onNewFolder && (
        <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onNewFolder} title={tr('Новая папка')}>
          <FolderPlus />
          <span className="max-xl:sr-only">{tr('Новая папка')}</span>
        </Button>
      )}
      <div role="group" aria-label={tr('Вид')} className="flex shrink-0 rounded-md border p-0.5">
        <Button type="button" size="icon" variant={view === 'icons' ? 'secondary' : 'ghost'} className="size-7" aria-pressed={view === 'icons'} aria-label={tr('Значки')} title={tr('Значки')} onClick={() => onView('icons')}>
          <LayoutGrid />
        </Button>
        <Button type="button" size="icon" variant={view === 'table' ? 'secondary' : 'ghost'} className="size-7" aria-pressed={view === 'table'} aria-label={tr('Таблица')} title={tr('Таблица')} onClick={() => onView('table')}>
          <List />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Плитки
// ---------------------------------------------------------------------------
interface TileEvents {
  selected: boolean
  onClick: (e: React.MouseEvent) => void
  onOpen: () => void
  onToggle: () => void
}

const tileBase =
  'group relative flex cursor-default select-none flex-col gap-1.5 rounded-lg border border-transparent p-2 text-left outline-none [-webkit-touch-callout:none] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring aria-selected:border-primary/40 aria-selected:bg-primary/10'

function tileKeys(e: React.KeyboardEvent, onOpen: () => void, onToggle: () => void) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter') {
    e.preventDefault()
    onOpen()
  } else if (e.key === ' ') {
    e.preventDefault()
    onToggle()
  }
}

function TileCheck({ selected, label, onToggle }: { selected: boolean; label: string; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      tabIndex={-1}
      aria-label={label}
      checked={selected}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={onToggle}
      className={cn('absolute left-3 top-3 z-10 size-4 opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100', selected && 'opacity-100')}
    />
  )
}

export function FolderTile({ node, count, dropActive, dropProps, selected, onClick, onOpen, onToggle }: TileEvents & {
  node: FolderNode
  count: number
  dropActive: boolean
  dropProps: React.HTMLAttributes<HTMLDivElement>
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-key={folderKey(node.id)}
      title={node.name}
      className={cn(tileBase, dropActive && 'border-signal bg-signal/20')}
      onClick={onClick}
      onDoubleClick={onOpen}
      onKeyDown={(e) => tileKeys(e, onOpen, onToggle)}
      {...dropProps}
    >
      <TileCheck selected={selected} label={tr('Выбрать папку: {{name}}', { name: node.name })} onToggle={onToggle} />
      <div className="grid aspect-[4/3] w-full place-items-center">
        <Folder className="size-16 fill-amber-300 text-amber-500 dark:fill-amber-400/70 dark:text-amber-400" strokeWidth={1.25} aria-hidden />
      </div>
      <span className="line-clamp-2 break-words text-center text-sm font-medium leading-snug">{node.name}</span>
      <span className="text-center text-xs tabular-nums text-muted-foreground">{count > 0 ? tr('Документов: {{n}}', { n: count }) : tr('Пусто')}</span>
    </div>
  )
}

export function DocTile({ d, folderPath, canThumbs, draggable, onDragStart, selected, onClick, onOpen, onToggle }: TileEvents & {
  d: DocumentRow
  /** где лежит документ — показываем, когда видны документы из разных папок (поиск, фильтры) */
  folderPath?: string
  canThumbs: boolean
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
}) {
  const revision = d.current_version_id ? d.current_revision || `№${d.current_version_no}` : null
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      data-key={d.id}
      title={d.code ? `${d.title}\n${d.code}` : d.title}
      draggable={draggable}
      onDragStart={onDragStart}
      className={tileBase}
      onClick={onClick}
      onDoubleClick={onOpen}
      onKeyDown={(e) => tileKeys(e, onOpen, onToggle)}
    >
      <TileCheck selected={selected} label={tr('Выбрать: {{title}}', { title: d.title })} onToggle={onToggle} />
      <DocThumb d={d} canGenerate={canThumbs} peek={false} className="aspect-[4/3] w-full" badgeClassName="h-7 min-w-12 px-2 text-xs" />
      <span className="line-clamp-2 break-words text-center text-sm font-medium leading-snug">{d.title}</span>
      <span className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-xs text-muted-foreground">
        {revision ? <span className="ident">{revision}</span> : <span>{tr('не выпущен')}</span>}
        <span aria-hidden>·</span>
        <span>{DOC_TYPE_LABELS[d.doc_type]}</span>
      </span>
      {folderPath && (
        <span className="flex items-center justify-center gap-1 truncate text-center text-xs text-muted-foreground">
          <Folder className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{folderPath}</span>
        </span>
      )}
      {d.ack_pending ? (
        <span className="mx-auto inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
          <BellRing className="size-3" aria-hidden />
          {tr('Ознакомьтесь')}
        </span>
      ) : !d.current_version_id ? (
        <span className="mx-auto rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{tr('Черновик')}</span>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Удаление выбранного
// ---------------------------------------------------------------------------
export function DeleteItemsDialog({ docs, folders, skipped, busy, onConfirm, onClose }: {
  docs: number
  folders: number
  /** выбрано, но удалить нельзя: нет права */
  skipped: number
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const what =
    docs > 0 && folders > 0
      ? tr('Удалить документов: {{docs}} и папок: {{folders}}?', { docs, folders })
      : folders > 0
        ? tr('Удалить папок: {{n}}?', { n: folders })
        : tr('Удалить документов: {{n}}?', { n: docs })
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{what}</DialogTitle>
          <DialogDescription>
            {docs > 0 && tr('Документы пропадут из списка проекта вместе с версиями.')}{' '}
            {folders > 0 && tr('Содержимое удаляемых папок не удаляется: оно поднимется на уровень выше.')}{' '}
            {skipped > 0 && tr('Ещё {{n}} из выбранного вы удалять не вправе — оно останется.', { n: skipped })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? tr('Удаляем…') : tr('Удалить')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
