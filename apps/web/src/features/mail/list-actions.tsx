import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { Archive, Check, CheckCheck, Copy, Flag, FolderInput, Mail, MailOpen, Pin, PinOff, ShieldAlert, SquareCheck, Trash2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  folderLabel,
  mailAct,
  MailError,
  mailErrorText,
  mailFoldersQuery,
  mailPinsQuery,
  mailReconnect,
  pinMail,
  refreshMailCounts,
  type MailFolder,
  type MailListItem,
  type MailOp,
} from '@/features/mail/api'
import { supabase } from '@/lib/supabase'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/**
 * Действия со списком писем, как в Outlook: кнопки при наведении на строку, меню по правой кнопке (на телефоне — долгое нажатие)
 * и панель над списком для отмеченных писем. Всё — на праве Mail.ReadWrite, новых прав в Entra не нужно. Закрепление хранится
 * у нас (в Outlook его не видно). Действие над строкой ветки применяется ко всем её письмам в этой папке.
 */

/**
 * Правка письма во всех загруженных списках (папки, поиск, фильтры, раскрытые ветки, закреплённые) без перезагрузки:
 * fn возвращает новое письмо или null — убрать из списка.
 */
export function patchMailLists(queryClient: QueryClient, id: string, fn: (m: MailListItem) => MailListItem | null) {
  const apply = (list: MailListItem[]) => list.flatMap((m) => (m.id === id ? (fn(m) ?? []) : [m]))
  queryClient.setQueriesData<InfiniteData<{ messages: MailListItem[]; next: string | null }> | MailListItem[]>({ queryKey: ['mail', 'messages'] }, (old) => {
    if (!old) return old
    if (Array.isArray(old)) return apply(old)
    return { ...old, pages: old.pages.map((p) => ({ ...p, messages: apply(p.messages) })) }
  })
}

export const needWrite = () =>
  toast.error(mailErrorText(new MailError('write_not_granted')), {
    action: { label: tr('Переподключить'), onClick: () => void mailReconnect().catch((e) => toast.error(mailErrorText(e))) },
  })

const REMOVES: MailOp[] = ['delete', 'archive', 'junk', 'move']

export interface MailActions {
  /** Действие над письмами; `target` — папка для «Переместить» и «Копировать» */
  run: (op: MailOp, items: MailListItem[], target?: MailFolder) => void
  pin: (item: MailListItem, on: boolean) => void
  pinned: Set<string>
  inTrash: boolean
  inJunk: boolean
}

export function useMailActions({ folder, writable, inTrash, inJunk, onRemoved }: { folder: string; writable: boolean; inTrash: boolean; inJunk: boolean; onRemoved: (ids: string[]) => void }): MailActions {
  const queryClient = useQueryClient()
  const { data: pins } = useQuery(mailPinsQuery)
  const pinned = new Set((pins ?? []).map((p) => p.message_id))

  const refresh = () => {
    refreshMailCounts(queryClient)
    // другие папки (куда перенесли) перечитаются, когда их откроют
    void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'], refetchType: 'none' })
  }

  async function execute(op: MailOp, items: MailListItem[], target?: MailFolder) {
    const ids = [...new Set(items.map((m) => m.id))]
    // сразу на экране, не дожидаясь Outlook
    for (const id of ids) {
      if (REMOVES.includes(op)) patchMailLists(queryClient, id, () => null)
      else if (op === 'read' || op === 'unread') patchMailLists(queryClient, id, (m) => ({ ...m, is_read: op === 'read' }))
      else if (op === 'flag' || op === 'complete' || op === 'unflag') patchMailLists(queryClient, id, (m) => ({ ...m, flagged: op === 'flag' }))
    }
    if (REMOVES.includes(op)) onRemoved(ids)

    const results: { id: string; ok: boolean; new_id?: string | null; from_folder?: string | null; permanent?: boolean }[] = []
    try {
      // по 50 за запрос
      for (let i = 0; i < ids.length; i += 50) results.push(...(await mailAct(op, ids.slice(i, i + 50), target?.id)).results)
    } catch (e) {
      toast.error(mailErrorText(e))
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] })
      return
    }
    const ok = results.filter((r) => r.ok)
    const failed = results.length - ok.length
    if (failed > 0) {
      toast.error(tr('Не получилось для {{n}} писем — список обновлён.', { n: failed }))
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] })
    }
    refresh()

    if (op === 'read' && ok.length) {
      // уведомления о прочитанных письмах в колокольчике — тоже прочитаны
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('group_key', ok.map((r) => `mail:${r.id}`))
        .is('read_at', null)
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
    if (REMOVES.includes(op) && ok.length) {
      // у перемещённого письма в Outlook новый id — закрепление снимаем
      const gone = ok.map((r) => r.id).filter((id) => pinned.has(id))
      if (gone.length) {
        await supabase.from('mail_pins').delete().in('message_id', gone)
        void queryClient.invalidateQueries({ queryKey: ['mail', 'pins'] })
      }
    }
    if (ok.length === 0) return

    const n = ok.length
    const movable = ok.filter((r) => r.new_id && r.from_folder)
    const undo = movable.length
      ? {
          label: tr('Отменить'),
          onClick: () => {
            const back = new Map<string, string[]>()
            for (const r of movable) back.set(r.from_folder!, [...(back.get(r.from_folder!) ?? []), r.new_id!])
            void Promise.all([...back].map(([to, list]) => mailAct('move', list, to)))
              .then(() => {
                void queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] })
                refresh()
              })
              .catch((e) => toast.error(mailErrorText(e)))
          },
        }
      : undefined
    const name = target ? folderLabel(target) : ''
    const text =
      op === 'delete'
        ? ok.some((r) => r.permanent)
          ? tr('Удалено окончательно: {{n}}', { n })
          : tr('Перемещено в «Удалённые»: {{n}}', { n })
        : op === 'archive'
          ? tr('Перемещено в архив: {{n}}', { n })
          : op === 'junk'
            ? tr('Перемещено в «Нежелательную почту»: {{n}}', { n })
            : op === 'move'
              ? tr('Перемещено в «{{folder}}»: {{n}}', { folder: name, n })
              : op === 'copy'
                ? tr('Скопировано в «{{folder}}»: {{n}}', { folder: name, n })
                : null
    if (text) toast.success(text, undo ? { action: undo } : undefined)
  }

  return {
    pinned,
    inTrash,
    inJunk,
    run: (op, items, target) => {
      if (!writable) return needWrite()
      if (items.length === 0) return
      // из «Удалённых» — навсегда: переспрашиваем
      if (op === 'delete' && inTrash) {
        toast(tr('Удалить окончательно писем: {{n}}? Это нельзя отменить.', { n: items.length }), {
          action: { label: tr('Удалить'), onClick: () => void execute(op, items, target) },
        })
        return
      }
      void execute(op, items, target)
    },
    pin: (item, on) =>
      void pinMail(item.id, folder, on)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['mail', 'pins'] })
          if (on) toast.success(tr('Закреплено вверху папки'))
        })
        .catch((e) => toast.error(mailErrorText(e))),
  }
}

/** Можно ли переместить письма из папки `from` в `f`: не в ту же самую, не в черновики и не в отправленные */
const canMoveTo = (f: MailFolder, from: string) => f.id !== from && f.well_known !== from && f.well_known !== 'drafts' && f.well_known !== 'sentitems'

/** Папки для «Переместить» и «Копировать»: системные и свои, кроме открытой */
function useTargetFolders(current: string): MailFolder[] {
  const { data } = useQuery(mailFoldersQuery)
  return (data ?? []).filter((f) => canMoveTo(f, current))
}

// ---------------------------------------------------------------------------
// Перетаскивание писем в папки (как в Outlook): тащим строку — или все отмеченные, если строка среди них;
// отпустили над папкой — «Переместить», с зажатым Ctrl (на Mac — Option) — «Копировать».
// Список и панель папок — в разных ветках дерева, поэтому то, что тащим, лежит здесь, одно на всё окно.
// ---------------------------------------------------------------------------
type MailDrag = { items: MailListItem[]; from: string; run: MailActions['run'] }
let mailDrag: MailDrag | null = null
const DRAG_TYPE = 'application/x-buildos-mail'

/** Перетаскивание только мышью: на телефоне долгое нажатие открывает меню строки */
export const canDragMail = () => typeof window !== 'undefined' && window.matchMedia('(any-pointer: fine)').matches

export function startMailDrag(e: ReactDragEvent, drag: MailDrag) {
  mailDrag = drag
  const n = new Set(drag.items.map((m) => m.id)).size
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData(DRAG_TYPE, String(n))
  // своя картинка под курсором: сколько писем тащим, а не снимок строки
  const ghost = document.createElement('div')
  ghost.textContent = tr('Писем: {{n}}', { n })
  ghost.className = 'fixed -left-[999px] top-0 rounded-md bg-mail px-3 py-1.5 text-sm font-medium text-mail-foreground shadow-lg'
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, -12, -8)
  window.setTimeout(() => ghost.remove())
}

export function endMailDrag() {
  mailDrag = null
}

/**
 * Папка как место, куда бросают письма. `over` — над ней сейчас письма (подсветить); `onHold` — задержались над
 * папкой (раскрыть подпапки, как в Outlook).
 */
export function useMailDrop(target: MailFolder | null | undefined, onHold?: () => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const hold = useRef(onHold)
  hold.current = onHold
  useEffect(() => {
    if (!over || !hold.current) return
    const t = window.setTimeout(() => hold.current?.(), 700)
    return () => window.clearTimeout(t)
  }, [over])

  const accepts = (e: ReactDragEvent) => !!target && !!mailDrag && e.dataTransfer.types.includes(DRAG_TYPE) && canMoveTo(target, mailDrag.from)
  const copy = (e: ReactDragEvent) => e.ctrlKey || e.altKey
  const reset = () => {
    depth.current = 0
    setOver(false)
  }
  return {
    over,
    dropProps: {
      onDragEnter: (e: ReactDragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        depth.current += 1
        setOver(true)
      },
      onDragOver: (e: ReactDragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = copy(e) ? 'copy' : 'move'
      },
      // уход на вложенный элемент тоже даёт dragleave — считаем входы и выходы
      onDragLeave: () => {
        if (depth.current === 0) return
        depth.current -= 1
        if (depth.current === 0) setOver(false)
      },
      onDrop: (e: ReactDragEvent) => {
        if (!accepts(e) || !target || !mailDrag) return reset()
        e.preventDefault()
        reset()
        const d = mailDrag
        mailDrag = null
        d.run(copy(e) ? 'copy' : 'move', d.items, target)
      },
    },
  }
}

function QuickButton({ label, icon: Icon, onClick, active, danger }: { label: string; icon: LucideIcon; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
        danger ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'text-destructive',
      )}
    >
      <Icon className={cn(active && 'fill-current')} />
    </button>
  )
}

/** Кнопки при наведении на строку: удалить, прочитано/непрочитано, флажок, закрепить. */
export function RowQuickActions({ items, head, actions, className }: { items: MailListItem[]; head: MailListItem; actions: MailActions; className?: string }) {
  const unread = items.some((m) => !m.is_read)
  const flagged = items.some((m) => m.flagged)
  const isPinned = actions.pinned.has(head.id)
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-2 top-2 z-[2] flex items-center gap-0.5 rounded-lg border bg-card p-0.5 opacity-0 shadow-sm transition-opacity',
        'group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none',
        className,
      )}
    >
      <QuickButton label={actions.inTrash ? tr('Удалить навсегда') : tr('Удалить')} icon={Trash2} danger onClick={() => actions.run('delete', items)} />
      <QuickButton label={unread ? tr('Отметить как прочитанное') : tr('Отметить как непрочитанное')} icon={unread ? MailOpen : Mail} onClick={() => actions.run(unread ? 'read' : 'unread', items)} />
      <QuickButton label={flagged ? tr('Снять флажок') : tr('Пометить флажком')} icon={Flag} active={flagged} onClick={() => actions.run(flagged ? 'unflag' : 'flag', items)} />
      <QuickButton label={isPinned ? tr('Открепить') : tr('Закрепить вверху')} icon={isPinned ? PinOff : Pin} onClick={() => actions.pin(head, !isPinned)} />
    </div>
  )
}

/** Отметка строки вместо аватара: видна при наведении и когда что-то уже отмечено. */
export function RowCheck({ checked, visible, label, onToggle, className }: { checked: boolean; visible: boolean; label: string; onToggle: (e: MouseEvent) => void; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(e)
      }}
      className={cn(
        'absolute z-[2] flex items-center justify-center rounded-full outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
        visible || checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        className,
      )}
    >
      <span className={cn('flex size-5 items-center justify-center rounded-[5px] border-2', checked ? 'border-mail bg-mail text-mail-foreground' : 'border-muted-foreground/60 bg-card')}>
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  )
}

/** Меню по правой кнопке мыши (на телефоне — долгое нажатие). `targets` — письма, к которым применяется действие. */
export function RowMenu({
  targets,
  head,
  folder,
  actions,
  onSelect,
  checked,
  children,
}: {
  targets: () => MailListItem[]
  head: MailListItem
  folder: string
  actions: MailActions
  onSelect: () => void
  checked: boolean
  children: ReactNode
}) {
  const folders = useTargetFolders(folder)
  const list = targets()
  const unread = list.some((m) => !m.is_read)
  const isPinned = actions.pinned.has(head.id)
  const run = (op: MailOp, target?: MailFolder) => actions.run(op, targets(), target)
  // несколько отмеченных строк (письма одной ветки — это одна строка)
  const many = list.some((m) => m.id !== head.id && (!head.conversation_id || m.conversation_id !== head.conversation_id))

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {many && <p className="px-2 py-1 text-xs text-muted-foreground">{tr('Писем: {{n}}', { n: list.length })}</p>}
        <ContextMenuItem onSelect={() => run('delete')} className="text-destructive focus:text-destructive">
          <Trash2 />
          {actions.inTrash ? tr('Удалить навсегда') : tr('Удалить')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => run('archive')}>
          <Archive />
          {tr('Архивировать')}
        </ContextMenuItem>
        <FolderSub label={tr('Переместить')} icon={FolderInput} folders={folders} onPick={(f) => run('move', f)} />
        <FolderSub label={tr('Копировать')} icon={Copy} folders={folders} onPick={(f) => run('copy', f)} />
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => run(unread ? 'read' : 'unread')}>
          {unread ? <MailOpen /> : <Mail />}
          {unread ? tr('Отметить как прочитанное') : tr('Отметить как непрочитанное')}
        </ContextMenuItem>
        {!many && (
          <ContextMenuItem onSelect={() => actions.pin(head, !isPinned)}>
            {isPinned ? <PinOff /> : <Pin />}
            {isPinned ? tr('Открепить') : tr('Закрепить вверху')}
          </ContextMenuItem>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Flag />
            {tr('Флажок')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem onSelect={() => run('flag')}>
              <Flag />
              {tr('Пометить флажком')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => run('complete')}>
              <CheckCheck />
              {tr('Отметить как выполненное')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => run('unflag')}>
              <X />
              {tr('Снять флажок')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {!actions.inJunk && (
          <ContextMenuItem onSelect={() => run('junk')}>
            <ShieldAlert />
            {tr('В нежелательную почту')}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onSelect}>
          <SquareCheck />
          {checked ? tr('Снять отметку') : tr('Отметить')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function FolderSub({ label, icon: Icon, folders, onPick }: { label: string; icon: LucideIcon; folders: MailFolder[]; onPick: (f: MailFolder) => void }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Icon />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
        {folders.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">{tr('Других папок нет')}</p>}
        {folders.map((f) => (
          <ContextMenuItem key={f.id} onSelect={() => onPick(f)}>
            <span className="truncate">{folderLabel(f)}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** Панель над списком, когда письма отмечены: действия сразу над всеми. */
export function BulkBar({
  items,
  count,
  total,
  folder,
  actions,
  onAll,
  onClear,
}: {
  items: MailListItem[]
  /** сколько строк отмечено (в ветке писем бывает больше) */
  count: number
  /** сколько строк загружено (для «Отметить все») */
  total: number
  folder: string
  actions: MailActions
  onAll: () => void
  onClear: () => void
}) {
  const folders = useTargetFolders(folder)
  const unread = items.some((m) => !m.is_read)
  const flagged = items.some((m) => m.flagged)
  const all = count > 0 && count >= total
  const icon = 'max-sm:px-2'
  return (
    <div role="toolbar" aria-label={tr('Действия с отмеченными письмами')} className="flex min-h-11 flex-wrap items-center gap-1 border-t bg-mail-soft/60 px-2 py-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={all ? true : 'mixed'}
        aria-label={all ? tr('Снять отметку со всех') : tr('Отметить все')}
        title={all ? tr('Снять отметку со всех') : tr('Отметить все')}
        onClick={() => (all ? onClear() : onAll())}
        className="flex size-8 items-center justify-center rounded-md outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-5 items-center justify-center rounded-[5px] border-2 border-mail bg-mail text-mail-foreground">
          {all ? <Check className="size-3.5" strokeWidth={3} /> : <span className="h-0.5 w-2.5 rounded bg-current" />}
        </span>
      </button>
      <span className="mr-1 text-sm font-medium tabular-nums">{tr('Отмечено: {{n}}', { n: count })}</span>
      <Button size="sm" variant="ghost" className={icon} onClick={() => actions.run(unread ? 'read' : 'unread', items)} title={unread ? tr('Прочитано') : tr('Непрочитано')}>
        {unread ? <MailOpen /> : <Mail />}
        <span className="max-md:sr-only">{unread ? tr('Прочитано') : tr('Непрочитано')}</span>
      </Button>
      <Button size="sm" variant="ghost" className={icon} onClick={() => actions.run(flagged ? 'unflag' : 'flag', items)} title={flagged ? tr('Снять флажок') : tr('Флажок')}>
        <Flag />
        <span className="max-md:sr-only">{flagged ? tr('Снять флажок') : tr('Флажок')}</span>
      </Button>
      <Button size="sm" variant="ghost" className={icon} onClick={() => actions.run('archive', items)} title={tr('Архивировать')}>
        <Archive />
        <span className="max-lg:sr-only">{tr('Архивировать')}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className={icon} title={tr('Переместить')}>
            <FolderInput />
            <span className="max-lg:sr-only">{tr('Переместить')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{tr('Переместить в папку')}</DropdownMenuLabel>
          {folders.map((f) => (
            <DropdownMenuItem key={f.id} onSelect={() => actions.run('move', items, f)}>
              <span className="truncate">{folderLabel(f)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" className={cn(icon, 'text-destructive hover:bg-destructive/10 hover:text-destructive')} onClick={() => actions.run('delete', items)} title={tr('Удалить')}>
        <Trash2 />
        <span className="max-md:sr-only">{actions.inTrash ? tr('Удалить навсегда') : tr('Удалить')}</span>
      </Button>
      <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={onClear} aria-label={tr('Снять отметку')} title={tr('Снять отметку')}>
        <X />
      </Button>
    </div>
  )
}
