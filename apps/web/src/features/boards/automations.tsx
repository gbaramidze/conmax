import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Pencil, Plus, Trash2, X, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  automationsQuery,
  deleteAutomation,
  labelColorName,
  POS_STEP,
  saveAutomation,
  setAutomationEnabled,
  type AutomationAction,
  type AutomationActionType,
  type AutomationDraft,
  type AutomationTrigger,
  type BoardAutomation,
  type BoardData,
} from '@/features/boards/api'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const fail = () => toast.error(tr('Не удалось сохранить. Попробуйте ещё раз.'))
const selectCls = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground'

const TRIGGERS: AutomationTrigger[] = ['completed', 'moved_to_list', 'created_in_list', 'stale', 'in_list_for', 'overdue']
const triggerName = (t: AutomationTrigger): string =>
  ({
    completed: tr('Карточку отметили выполненной'),
    moved_to_list: tr('Карточку перенесли в колонку'),
    created_in_list: tr('Карточку создали'),
    stale: tr('Карточку не обновляли N дней'),
    in_list_for: tr('Карточка лежит в колонке N дней'),
    overdue: tr('Срок карточки прошёл'),
  })[t]
const TIMED: AutomationTrigger[] = ['stale', 'in_list_for', 'overdue']

const ACTIONS: AutomationActionType[] = ['move', 'archive', 'complete', 'add_label', 'remove_label', 'comment', 'notify', 'create_card']
const actionName = (t: AutomationActionType): string =>
  ({
    move: tr('Перенести в колонку'),
    archive: tr('Отправить в архив'),
    complete: tr('Отметить выполненной'),
    add_label: tr('Поставить метку'),
    remove_label: tr('Снять метку'),
    comment: tr('Написать комментарий'),
    notify: tr('Прислать уведомление'),
    create_card: tr('Создать карточку'),
  })[t]

function blankAction(type: AutomationActionType, data: BoardData): AutomationAction {
  const list = data.lists.find((l) => !l.archived_at)?.id ?? ''
  const label = data.labels[0]?.id ?? ''
  switch (type) {
    case 'move':
      return { type, list_id: list }
    case 'add_label':
    case 'remove_label':
      return { type, label_id: label }
    case 'comment':
    case 'notify':
      return { type, text: '' }
    case 'create_card':
      return { type, list_id: list, title: '', description: '' }
    default:
      return { type }
  }
}

// ---------------------------------------------------------------------------
// Текст правила: «Когда … → …»
// ---------------------------------------------------------------------------
function useNames(data: BoardData) {
  const list = (id: string | null | undefined) => data.lists.find((l) => l.id === id)?.title ?? tr('удалённая колонка')
  const label = (id: string) => {
    const l = data.labels.find((x) => x.id === id)
    return l ? l.name || labelColorName(l.color) : tr('удалённая метка')
  }
  const trigger = (r: Pick<BoardAutomation, 'trigger' | 'trigger_list_id' | 'trigger_days'>): string => {
    switch (r.trigger) {
      case 'completed':
        return tr('Когда карточку отметили выполненной')
      case 'moved_to_list':
        return tr('Когда карточку перенесли в «{{list}}»', { list: list(r.trigger_list_id) })
      case 'created_in_list':
        return r.trigger_list_id ? tr('Когда карточку создали в «{{list}}»', { list: list(r.trigger_list_id) }) : tr('Когда создали карточку')
      case 'stale':
        return tr('Когда карточку не обновляли {{n}} дн.', { n: r.trigger_days ?? 0 })
      case 'in_list_for':
        return tr('Когда карточка лежит в «{{list}}» {{n}} дн.', { list: list(r.trigger_list_id), n: r.trigger_days ?? 0 })
      case 'overdue':
        return tr('Когда срок карточки прошёл')
    }
  }
  const action = (a: AutomationAction): string => {
    switch (a.type) {
      case 'move':
        return tr('перенести в «{{list}}»', { list: list(a.list_id) })
      case 'archive':
        return tr('отправить в архив')
      case 'complete':
        return tr('отметить выполненной')
      case 'add_label':
        return tr('поставить метку «{{label}}»', { label: label(a.label_id) })
      case 'remove_label':
        return tr('снять метку «{{label}}»', { label: label(a.label_id) })
      case 'comment':
        return tr('написать «{{text}}»', { text: a.text })
      case 'notify':
        return tr('уведомить: «{{text}}»', { text: a.text })
      case 'create_card':
        return tr('создать карточку «{{title}}» в «{{list}}»', { title: a.title, list: list(a.list_id) })
    }
  }
  return { trigger, action }
}

// ---------------------------------------------------------------------------
// Готовые примеры
// ---------------------------------------------------------------------------
function examples(data: BoardData): { name: string; draft: AutomationDraft }[] {
  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const done = lists.find((l) => /готов|done|მზად/i.test(l.title)) ?? lists.at(-1)
  const first = lists[0]
  const red = data.labels.find((l) => l.color === 'red') ?? data.labels[0]
  const out: { name: string; draft: AutomationDraft }[] = []
  const base = { title: '', enabled: true, trigger_list_id: null, trigger_days: null }
  if (done) {
    out.push({ name: tr('Выполнена → в «{{list}}»', { list: done.title }), draft: { ...base, trigger: 'completed', actions: [{ type: 'move', list_id: done.id }] } })
  }
  if (red) {
    out.push({
      name: tr('3 дня без обновлений → метка и комментарий'),
      draft: {
        ...base,
        trigger: 'stale',
        trigger_days: 3,
        actions: [
          { type: 'add_label', label_id: red.id },
          { type: 'comment', text: tr('Требует обновления') },
        ],
      },
    })
  }
  if (done && first) {
    out.push({
      name: tr('В «{{list}}» → карточка на приёмку', { list: done.title }),
      draft: {
        ...base,
        trigger: 'moved_to_list',
        trigger_list_id: done.id,
        actions: [{ type: 'create_card', list_id: first.id, title: tr('Приёмка: {{title}}', { title: '{{title}}' }), description: '' }],
      },
    })
    out.push({
      name: tr('Неделю в «{{list}}» → в архив', { list: done.title }),
      draft: { ...base, trigger: 'in_list_for', trigger_list_id: done.id, trigger_days: 7, actions: [{ type: 'archive' }] },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Панель в меню доски
// ---------------------------------------------------------------------------
export function AutomationsPanel({ data }: { data: BoardData }) {
  const qc = useQueryClient()
  const boardId = data.board.id
  const { data: rules, isPending } = useQuery(automationsQuery(boardId))
  const [editing, setEditing] = useState<{ id?: string; draft: AutomationDraft } | null>(null)
  const names = useNames(data)
  const refresh = () => qc.invalidateQueries({ queryKey: ['board-automations', boardId] })
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch {
      fail()
    } finally {
      await refresh()
    }
  }

  if (editing) {
    return (
      <AutomationEditor
        data={data}
        initial={editing.draft}
        onCancel={() => setEditing(null)}
        onSave={async (draft) => {
          const position = Math.max(0, ...(rules ?? []).map((r) => r.position)) + POS_STEP
          await saveAutomation(boardId, draft, editing.id, position)
          await refresh()
          setEditing(null)
          toast.success(tr('Правило сохранено'))
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="text-xs text-muted-foreground">
        {tr('Правила делают рутину за вас: когда с карточкой что-то происходит или по времени (проверка каждые 5 минут).')}
      </p>

      {isPending && <div className="h-16 animate-pulse rounded-lg bg-muted" />}
      {rules?.length === 0 && (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center">
          <Zap className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{tr('Правил пока нет')}</p>
          <p className="text-xs text-muted-foreground">{tr('Создайте своё или начните с примера ниже.')}</p>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rules?.map((r) => (
          <li key={r.id} className={cn('rounded-lg border bg-card p-3', !r.enabled && 'opacity-60')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {r.title && <p className="mb-1 text-sm font-semibold">{r.title}</p>}
                <p className="text-sm">{names.trigger(r)}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {r.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 break-words">{names.action(a)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={r.enabled ? tr('Выключить правило') : tr('Включить правило')}
                onClick={() => void run(() => setAutomationEnabled(r.id, !r.enabled))}
                className={cn(
                  'relative mt-0.5 h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  r.enabled ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              >
                <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]', r.enabled ? 'left-[18px]' : 'left-0.5')} />
              </button>
            </div>
            <div className="mt-2 flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => setEditing({ id: r.id, draft: { title: r.title, enabled: r.enabled, trigger: r.trigger, trigger_list_id: r.trigger_list_id, trigger_days: r.trigger_days, actions: r.actions } })}
              >
                <Pencil /> {tr('Изменить')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm(tr('Удалить правило?'))) void run(() => deleteAutomation(r.id))
                }}
              >
                <Trash2 /> {tr('Удалить')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        onClick={() => setEditing({ draft: { title: '', enabled: true, trigger: 'completed', trigger_list_id: null, trigger_days: null, actions: [blankAction('move', data)] } })}
      >
        <Plus /> {tr('Создать правило')}
      </Button>

      {examples(data).length > 0 && (
        <section className="mt-1 flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground">{tr('Примеры')}</h4>
          {examples(data).map((ex) => (
            <button
              key={ex.name}
              type="button"
              onClick={() => setEditing({ draft: ex.draft })}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {ex.name}
            </button>
          ))}
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Редактор правила
// ---------------------------------------------------------------------------
function AutomationEditor({
  data,
  initial,
  onSave,
  onCancel,
}: {
  data: BoardData
  initial: AutomationDraft
  onSave: (d: AutomationDraft) => Promise<void>
  onCancel: () => void
}) {
  const [d, setD] = useState<AutomationDraft>(initial)
  const [busy, setBusy] = useState(false)
  const lists = data.lists.filter((l) => !l.archived_at).sort((a, b) => a.position - b.position)
  const labels = [...data.labels].sort((a, b) => a.position - b.position)
  const needsList = d.trigger === 'moved_to_list' || d.trigger === 'in_list_for'
  const optionalList = d.trigger === 'created_in_list'
  const needsDays = d.trigger === 'stale' || d.trigger === 'in_list_for'

  const setTrigger = (trigger: AutomationTrigger) =>
    setD((x) => ({
      ...x,
      trigger,
      trigger_list_id: trigger === 'moved_to_list' || trigger === 'in_list_for' ? (x.trigger_list_id ?? lists.at(-1)?.id ?? null) : trigger === 'created_in_list' ? x.trigger_list_id : null,
      trigger_days: trigger === 'stale' || trigger === 'in_list_for' ? (x.trigger_days ?? 3) : null,
    }))
  const setAction = (i: number, a: AutomationAction) => setD((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? a : y)) }))

  const valid =
    (!needsList || !!d.trigger_list_id) &&
    (!needsDays || (!!d.trigger_days && d.trigger_days >= 1 && d.trigger_days <= 365)) &&
    d.actions.length > 0 &&
    d.actions.every((a) => {
      if (a.type === 'move') return !!a.list_id
      if (a.type === 'add_label' || a.type === 'remove_label') return !!a.label_id
      if (a.type === 'comment' || a.type === 'notify') return !!a.text.trim()
      if (a.type === 'create_card') return !!a.list_id && !!a.title.trim()
      return true
    })

  const listSelect = (value: string, onChange: (v: string) => void, label: string, anyLabel?: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={selectCls}>
      {anyLabel && <option value="">{anyLabel}</option>}
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.title}
        </option>
      ))}
    </select>
  )

  return (
    <form
      className="flex flex-col gap-4 p-1"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid || busy) return
        setBusy(true)
        try {
          await onSave(d)
        } catch {
          fail()
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
        {tr('Название (необязательно)')}
        <Input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} className="h-9 font-normal" />
      </label>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">{tr('Когда')}</legend>
        <select value={d.trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)} aria-label={tr('Условие')} className={selectCls}>
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>
              {triggerName(t)}
            </option>
          ))}
        </select>
        {(needsList || optionalList) &&
          listSelect(d.trigger_list_id ?? '', (v) => setD({ ...d, trigger_list_id: v || null }), tr('Колонка'), optionalList ? tr('в любой колонке') : undefined)}
        {needsDays && (
          <label className="flex items-center gap-2 text-sm">
            <Input
              type="number"
              min={1}
              max={365}
              value={d.trigger_days ?? ''}
              onChange={(e) => setD({ ...d, trigger_days: e.target.value ? Number(e.target.value) : null })}
              aria-label={tr('Дней')}
              className="h-9 w-20"
            />
            {tr('дней')}
          </label>
        )}
        {TIMED.includes(d.trigger) && <p className="text-xs text-muted-foreground">{tr('Проверяется каждые 5 минут; на одну карточку срабатывает один раз, пока её снова не обновят.')}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-semibold">{tr('Тогда')}</legend>
        {d.actions.map((a, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-2">
            <div className="flex items-center gap-1">
              <select value={a.type} onChange={(e) => setAction(i, blankAction(e.target.value as AutomationActionType, data))} aria-label={tr('Действие')} className={selectCls}>
                {ACTIONS.map((t) => (
                  <option key={t} value={t}>
                    {actionName(t)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={d.actions.length === 1}
                aria-label={tr('Убрать действие')}
                onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            </div>
            {a.type === 'move' && listSelect(a.list_id, (v) => setAction(i, { ...a, list_id: v }), tr('Колонка'))}
            {(a.type === 'add_label' || a.type === 'remove_label') &&
              (labels.length > 0 ? (
                <select value={a.label_id} onChange={(e) => setAction(i, { ...a, label_id: e.target.value })} aria-label={tr('Метка')} className={selectCls}>
                  {labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name ? `${l.name} (${labelColorName(l.color)})` : labelColorName(l.color)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground">{tr('На доске пока нет меток.')}</p>
              ))}
            {(a.type === 'comment' || a.type === 'notify') && (
              <>
                <Input
                  value={a.text}
                  maxLength={2000}
                  onChange={(e) => setAction(i, { ...a, text: e.target.value })}
                  placeholder={a.type === 'comment' ? tr('Например: требует обновления') : tr('Текст уведомления')}
                  aria-label={tr('Текст')}
                  className="h-9"
                />
                {a.type === 'notify' && !TIMED.includes(d.trigger) && (
                  <p className="text-xs text-muted-foreground">{tr('О ваших же действиях уведомление не приходит — оно полезно в правилах по времени.')}</p>
                )}
              </>
            )}
            {a.type === 'create_card' && (
              <>
                {listSelect(a.list_id, (v) => setAction(i, { ...a, list_id: v }), tr('Колонка'))}
                <Input value={a.title} maxLength={500} onChange={(e) => setAction(i, { ...a, title: e.target.value })} placeholder={tr('Название')} aria-label={tr('Название')} className="h-9" />
                <Textarea
                  value={a.description}
                  rows={2}
                  maxLength={20000}
                  onChange={(e) => setAction(i, { ...a, description: e.target.value })}
                  placeholder={tr('Описание (необязательно)')}
                  aria-label={tr('Описание')}
                />
                <p className="text-xs text-muted-foreground">{tr('{{title}} — название исходной карточки, {{list}} — её колонка.', { title: '{{title}}', list: '{{list}}' })}</p>
              </>
            )}
          </div>
        ))}
        {d.actions.length < 10 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setD({ ...d, actions: [...d.actions, blankAction('archive', data)] })}>
            <Plus /> {tr('Добавить действие')}
          </Button>
        )}
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={!valid || busy}>
          {tr('Сохранить')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tr('Отмена')}
        </Button>
      </div>
    </form>
  )
}

/** Подпись «Автоматизация» для истории и комментариев */
export function AutomationBadge({ children }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold">
      <Zap className="size-3.5 text-[#f5cd47]" aria-hidden />
      {children ?? tr('Автоматизация')}
    </span>
  )
}
