import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, Eye, Lock, Pencil, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UserAvatar } from '@/features/profile/avatar'
import {
  createLabel,
  deleteLabel,
  LABEL_COLORS,
  LABEL_STYLE,
  labelColorName,
  POS_STEP,
  refreshBoard,
  updateLabel,
  type BoardLabel,
  type CardVisibility,
  type LabelColor,
} from '@/features/boards/api'
import type { BoardPerson } from '@/features/boards/people'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

/** Всплывающее окно в духе Trello: заголовок по центру, крестик, содержимое. */
export function PickerPopover({
  trigger,
  title,
  open,
  onOpenChange,
  children,
  onBack,
  className,
}: {
  trigger: ReactNode
  title: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  onBack?: () => void
  className?: string
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={cn('w-[304px] p-3', className)} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="relative mb-3 flex h-8 items-center justify-center">
          {onBack && (
            <Button type="button" variant="ghost" size="icon-sm" className="absolute left-0" aria-label={tr('Назад')} onClick={onBack}>
              <ChevronLeft />
            </Button>
          )}
          <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Метки: выбор, создание, правка
// ---------------------------------------------------------------------------
export function LabelsPicker({
  boardId,
  labels,
  selected,
  onToggle,
  trigger,
  title = tr('Метки'),
}: {
  boardId: string
  labels: BoardLabel[]
  selected: Set<string>
  onToggle: (labelId: string, on: boolean) => Promise<void> | void
  trigger: ReactNode
  title?: string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<BoardLabel | 'new' | null>(null)
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return [...labels].sort((a, b) => a.position - b.position).filter((l) => !n || l.name.toLowerCase().includes(n) || labelColorName(l.color).includes(n))
  }, [labels, q])

  return (
    <PickerPopover
      trigger={trigger}
      title={editing ? (editing === 'new' ? tr('Создание метки') : tr('Изменение метки')) : title}
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setEditing(null)
      }}
      onBack={editing ? () => setEditing(null) : undefined}
    >
      {editing ? (
        <LabelEditor
          label={editing === 'new' ? null : editing}
          onSave={async (name, color) => {
            try {
              if (editing === 'new') await createLabel(boardId, name, color, Math.max(0, ...labels.map((l) => l.position)) + POS_STEP)
              else await updateLabel(editing.id, { name, color })
              await refreshBoard(qc, boardId)
              setEditing(null)
            } catch {
              toast.error(tr('Не удалось сохранить метку.'))
            }
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  if (!window.confirm(tr('Удалить метку? Она пропадёт со всех карточек. Это нельзя отменить.'))) return
                  try {
                    await deleteLabel(editing.id)
                    await refreshBoard(qc, boardId)
                    setEditing(null)
                  } catch {
                    toast.error(tr('Не удалось удалить метку.'))
                  }
                }
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск меток…')} aria-label={tr('Поиск меток')} className="h-9" />
          <p className="mt-1 text-xs font-semibold text-muted-foreground">{tr('Метки')}</p>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {shown.map((l) => {
              const on = selected.has(l.id)
              return (
                <li key={l.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={l.name || labelColorName(l.color)}
                    onClick={() => void onToggle(l.id, !on)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span
                      className="flex h-8 min-w-0 flex-1 items-center truncate rounded px-3 text-sm font-medium hover:opacity-90"
                      style={{ background: LABEL_STYLE[l.color].bg, color: LABEL_STYLE[l.color].fg }}
                    >
                      {l.name}
                    </span>
                  </button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={tr('Изменить метку')} onClick={() => setEditing(l)}>
                    <Pencil />
                  </Button>
                </li>
              )
            })}
            {shown.length === 0 && <li className="py-2 text-center text-sm text-muted-foreground">{tr('Меток не нашли.')}</li>}
          </ul>
          <Button type="button" variant="secondary" className="w-full" onClick={() => setEditing('new')}>
            {tr('Создать новую метку')}
          </Button>
        </div>
      )}
    </PickerPopover>
  )
}

function LabelEditor({
  label,
  onSave,
  onDelete,
}: {
  label: BoardLabel | null
  onSave: (name: string, color: LabelColor) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [name, setName] = useState(label?.name ?? '')
  const [color, setColor] = useState<LabelColor>(label?.color ?? 'green')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-14 items-center justify-center rounded-md bg-muted px-6">
        <span className="flex h-8 w-full items-center truncate rounded px-3 text-sm font-medium" style={{ background: LABEL_STYLE[color].bg, color: LABEL_STYLE[color].fg }}>
          {name}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
        {tr('Название')}
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus className="h-9" />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">{tr('Цвет')}</span>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={tr('Цвет')}>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={labelColorName(c)}
              title={labelColorName(c)}
              onClick={() => setColor(c)}
              className={cn('flex h-8 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring', color === c && 'ring-2 ring-primary ring-offset-2 ring-offset-popover')}
              style={{ background: LABEL_STYLE[c].bg, color: LABEL_STYLE[c].fg }}
            >
              {color === c && <Check className="size-4" />}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onSave(name, color)
            setBusy(false)
          }}
        >
          {label ? tr('Сохранить') : tr('Создать')}
        </Button>
        {onDelete && (
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void onDelete()}>
            {tr('Удалить')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Люди: выбор участников карточки (и фильтра)
// ---------------------------------------------------------------------------
export function PeoplePicker({
  people,
  selected,
  onToggle,
  trigger,
  title = tr('Участники'),
}: {
  people: BoardPerson[]
  selected: Set<string>
  onToggle: (userId: string, on: boolean) => Promise<void> | void
  trigger: ReactNode
  title?: string
}) {
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const shown = people.filter((p) => !n || p.full_name.toLowerCase().includes(n) || (p.hint ?? '').toLowerCase().includes(n))
  const inCard = shown.filter((p) => selected.has(p.id))
  const rest = shown.filter((p) => !selected.has(p.id))
  const row = (p: BoardPerson) => {
    const on = selected.has(p.id)
    return (
      <li key={p.id}>
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          onClick={() => void onToggle(p.id, !on)}
          className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserAvatar name={p.full_name} path={p.avatar_path} className="size-7 text-[11px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{p.full_name}</span>
            {p.hint && <span className="block truncate text-xs text-muted-foreground">{p.hint}</span>}
          </span>
          {on && <Check className="size-4 text-primary" />}
        </button>
      </li>
    )
  }
  return (
    <PickerPopover trigger={trigger} title={title}>
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск участников')} aria-label={tr('Поиск участников')} className="h-9 pl-8" />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {inCard.length > 0 && (
            <>
              <p className="mb-1 mt-1 text-xs font-semibold text-muted-foreground">{tr('Выбраны')}</p>
              <ul className="flex flex-col">{inCard.map(row)}</ul>
            </>
          )}
          {rest.length > 0 && (
            <>
              <p className="mb-1 mt-2 text-xs font-semibold text-muted-foreground">{tr('Участники доски')}</p>
              <ul className="flex flex-col">{rest.map(row)}</ul>
            </>
          )}
          {shown.length === 0 && <p className="py-2 text-center text-sm text-muted-foreground">{tr('Никого не нашли.')}</p>}
        </div>
      </div>
    </PickerPopover>
  )
}

// ---------------------------------------------------------------------------
// Обложка
// ---------------------------------------------------------------------------
export function CoverPicker({
  value,
  onChange,
  trigger,
  hasPhoto,
}: {
  value: LabelColor | null
  onChange: (c: LabelColor | null) => void
  trigger: ReactNode
  /** Сейчас обложка — фото из вложений */
  hasPhoto?: boolean
}) {
  return (
    <PickerPopover trigger={trigger} title={tr('Обложка')}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={tr('Цвет обложки')}>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={value === c}
              aria-label={labelColorName(c)}
              title={labelColorName(c)}
              onClick={() => onChange(c)}
              className={cn('h-8 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring', value === c && 'ring-2 ring-primary ring-offset-2 ring-offset-popover')}
              style={{ background: LABEL_STYLE[c].bg }}
            />
          ))}
        </div>
        {hasPhoto && <p className="text-xs text-muted-foreground">{tr('Сейчас обложка — фото. Выбор цвета заменит его; другое фото — в меню вложения «Сделать обложкой».')}</p>}
        {(value || hasPhoto) && (
          <Button type="button" variant="secondary" onClick={() => onChange(null)}>
            {tr('Убрать обложку')}
          </Button>
        )}
      </div>
    </PickerPopover>
  )
}

// ---------------------------------------------------------------------------
// Даты: начало и срок
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export function DatesPicker({
  startDate,
  dueAt,
  onSave,
  trigger,
}: {
  startDate: string | null
  dueAt: string | null
  onSave: (v: { start_date: string | null; due_at: string | null }) => Promise<void>
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const due = dueAt ? new Date(dueAt) : null
  const [useStart, setUseStart] = useState(!!startDate)
  const [start, setStart] = useState(startDate ?? localDate(new Date()))
  const [useDue, setUseDue] = useState(!!dueAt || !startDate)
  const [dueDay, setDueDay] = useState(due ? localDate(due) : localDate(new Date(Date.now() + 86400_000)))
  const [dueTime, setDueTime] = useState(due ? localTime(due) : '12:00')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setUseStart(!!startDate)
    setStart(startDate ?? localDate(new Date()))
    setUseDue(!!dueAt || !startDate)
    setDueDay(due ? localDate(due) : localDate(new Date(Date.now() + 86400_000)))
    setDueTime(due ? localTime(due) : '12:00')
  }

  const save = async (v: { start_date: string | null; due_at: string | null }) => {
    setBusy(true)
    try {
      await onSave(v)
      setOpen(false)
    } catch {
      toast.error(tr('Не удалось сохранить даты.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PickerPopover
      trigger={trigger}
      title={tr('Даты')}
      open={open}
      onOpenChange={(o) => {
        if (o) reset()
        setOpen(o)
      }}
    >
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold text-muted-foreground">{tr('Начало')}</legend>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={useStart} onChange={(e) => setUseStart(e.target.checked)} aria-label={tr('Указать начало')} className="size-4 accent-primary" />
            <Input type="date" value={start} disabled={!useStart} onChange={(e) => setStart(e.target.value)} aria-label={tr('Дата начала')} className="h-9" />
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold text-muted-foreground">{tr('Срок')}</legend>
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={useDue} onChange={(e) => setUseDue(e.target.checked)} aria-label={tr('Указать срок')} className="size-4 accent-primary" />
            <Input type="date" value={dueDay} disabled={!useDue} onChange={(e) => setDueDay(e.target.value)} aria-label={tr('Дата срока')} className="h-9 min-w-0 flex-1" />
            <Input type="time" value={dueTime} disabled={!useDue} onChange={(e) => setDueTime(e.target.value)} aria-label={tr('Время срока')} className="h-9 w-24" />
          </div>
        </fieldset>
        <Button
          type="button"
          disabled={busy || (useStart && !start) || (useDue && !dueDay)}
          onClick={() =>
            void save({
              start_date: useStart ? start : null,
              due_at: useDue ? new Date(`${dueDay}T${dueTime || '12:00'}`).toISOString() : null,
            })
          }
        >
          {tr('Сохранить')}
        </Button>
        {(startDate || dueAt) && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save({ start_date: null, due_at: null })}>
            {tr('Удалить даты')}
          </Button>
        )}
      </div>
    </PickerPopover>
  )
}

// ---------------------------------------------------------------------------
// Видимость карточки общей доски: все или только выбранные (меняет автор)
// ---------------------------------------------------------------------------
export function VisibilityPicker({
  value,
  people,
  viewers,
  members,
  onChange,
  onToggleViewer,
  trigger,
}: {
  value: CardVisibility
  /** Кого можно выбрать: все, кто видит доску, кроме автора */
  people: BoardPerson[]
  viewers: Set<string>
  /** Участники карточки видят её всегда */
  members: Set<string>
  onChange: (v: CardVisibility) => Promise<void> | void
  onToggleViewer: (userId: string, on: boolean) => Promise<void> | void
  trigger: ReactNode
}) {
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const shown = people.filter((p) => !n || p.full_name.toLowerCase().includes(n) || (p.hint ?? '').toLowerCase().includes(n))
  const option = (v: CardVisibility, icon: ReactNode, title: string, hint: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === v}
      onClick={() => value !== v && void onChange(v)}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        value === v ? 'border-primary bg-primary/5' : 'border-transparent',
      )}
    >
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      {value === v && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
    </button>
  )
  return (
    <PickerPopover trigger={trigger} title={tr('Кто видит карточку')} className="w-[320px]">
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={tr('Кто видит карточку')} className="flex flex-col gap-1">
          {option('all', <Eye />, tr('Все участники доски'), tr('По умолчанию. Карточку видит каждый, кто видит доску.'))}
          {option('selected', <Lock />, tr('Только выбранные'), tr('Вы, участники карточки и те, кого вы отметите. Остальные — даже руководитель доски — её не увидят.'))}
        </div>
        {value === 'selected' && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Поиск участников')} aria-label={tr('Поиск участников')} className="h-9 pl-8" />
            </div>
            <ul className="flex max-h-64 flex-col overflow-y-auto">
              {shown.map((p) => {
                const member = members.has(p.id)
                const on = member || viewers.has(p.id)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={member}
                      onClick={() => void onToggleViewer(p.id, !on)}
                      className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none enabled:hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                    >
                      <UserAvatar name={p.full_name} path={p.avatar_path} className="size-7 text-[11px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.full_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{member ? tr('Участник карточки — видит всегда') : p.hint}</span>
                      </span>
                      {on && <Check className="size-4 text-primary" />}
                    </button>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="py-2 text-center text-sm text-muted-foreground">{tr('Никого не нашли.')}</li>}
            </ul>
          </div>
        )}
      </div>
    </PickerPopover>
  )
}
