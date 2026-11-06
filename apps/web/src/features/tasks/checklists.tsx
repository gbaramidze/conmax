import { tr } from '@/lib/tr'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, ListChecks, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

interface ChecklistItem {
  id: string
  text: string
  done: boolean
  sort: number
}
interface Checklist {
  id: string
  title: string
  sort: number
  items: ChecklistItem[]
}

const checklistsKey = (taskId: string) => ['checklists', 'task', taskId] as const

export const checklistsQuery = (taskId: string) =>
  queryOptions({
    queryKey: checklistsKey(taskId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checklists')
        .select('id, title, sort, items:checklist_items(id, text, done, sort)')
        .eq('entity_type', 'task')
        .eq('entity_id', taskId)
        .order('sort')
      if (error) throw error
      return (data as unknown as Checklist[]).map((c) => ({ ...c, items: [...c.items].sort((a, b) => a.sort - b.sort) }))
    },
  })

async function run<T>(p: PromiseLike<{ error: { message: string } | null; data?: T }>): Promise<void> {
  const { error } = await p
  if (error) throw new Error(error.message)
}

/** Чек-листы задачи: несколько списков, отметки, быстрое добавление (вставка многострочного текста создаёт пункты). */
export function ChecklistsSection({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const { data: lists, isPending } = useQuery(checklistsQuery(taskId))
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: checklistsKey(taskId) })
  const fail = () => toast.error(tr('Не удалось сохранить. Проверьте права и попробуйте ещё раз.'))

  const create = useMutation({
    mutationFn: () => run(supabase.from('checklists').insert({ entity_type: 'task', entity_id: taskId, title: title.trim() || tr('Чек-лист') } as never)),
    onSuccess: async () => {
      setTitle('')
      setCreating(false)
      await refresh()
    },
    onError: fail,
  })

  if (isPending) return null
  const empty = (lists ?? []).length === 0
  if (empty && !canEdit) return null

  return (
    <section className="flex flex-col gap-3" aria-label={tr('Чек-листы')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="size-4 text-muted-foreground" aria-hidden />{tr('Чек-листы')}</h3>
        {canEdit && !creating && (
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus />{tr('Чек-лист')}</Button>
        )}
      </div>

      {creating && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <Input
            autoFocus
            aria-label={tr('Название чек-листа')}
            placeholder={tr('Например, Приёмка арматуры')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
          <Button type="submit" disabled={create.isPending}>{tr('Создать')}</Button>
        </form>
      )}

      {empty && !creating && <p className="text-sm text-muted-foreground">{tr('Разбейте работу на пункты и отмечайте выполненные.')}</p>}

      {(lists ?? []).map((l) => (
        <ChecklistBlock key={l.id} list={l} canEdit={canEdit} onChanged={refresh} onError={fail} />
      ))}
    </section>
  )
}

function ChecklistBlock({
  list,
  canEdit,
  onChanged,
  onError,
}: {
  list: Checklist
  canEdit: boolean
  onChanged: () => Promise<unknown>
  onError: () => void
}) {
  const [hideDone, setHideDone] = useState(false)
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const done = list.items.filter((i) => i.done).length
  const total = list.items.length
  const pct = total ? Math.round((done / total) * 100) : 0
  const visible = hideDone ? list.items.filter((i) => !i.done) : list.items

  const rename = useMutation({
    mutationFn: (t: string) => run(supabase.from('checklists').update({ title: t }).eq('id', list.id)),
    onSuccess: async () => {
      setRenaming(null)
      await onChanged()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: () => run(supabase.from('checklists').delete().eq('id', list.id)),
    onSuccess: onChanged,
    onError,
  })
  const addItems = useMutation({
    mutationFn: async (text: string) => {
      const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      for (const line of lines) await run(supabase.from('checklist_items').insert({ checklist_id: list.id, text: line.slice(0, 500) } as never))
    },
    onSuccess: async () => {
      setAdding('')
      await onChanged()
    },
    onError,
  })

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        {renaming !== null ? (
          <Input
            autoFocus
            aria-label={tr('Название чек-листа')}
            className="h-9 flex-1 font-medium"
            value={renaming}
            maxLength={200}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={() => (renaming.trim() && renaming.trim() !== list.title ? rename.mutate(renaming.trim()) : setRenaming(null))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setRenaming(list.title)}
            className="min-w-0 flex-1 truncate rounded px-1 text-left text-sm font-medium outline-none enabled:hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            {list.title}
          </button>
        )}
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="md:size-8"
          aria-label={hideDone ? tr('Показать выполненные') : tr('Скрыть выполненные')}
          title={hideDone ? tr('Показать выполненные') : tr('Скрыть выполненные')}
          aria-pressed={hideDone}
          onClick={() => setHideDone((v) => !v)}
        >
          {hideDone ? <EyeOff /> : <Eye />}
        </Button>
        {canEdit &&
          (confirmDelete ? (
            <span className="flex items-center gap-1">
              <Button type="button" size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{tr('Удалить')}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{tr('Нет')}</Button>
            </span>
          ) : (
            <Button type="button" size="icon" variant="ghost" className="md:size-8" aria-label={tr('Удалить чек-лист {{title}}', { title: list.title })} title={tr('Удалить чек-лист')} onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          ))}
      </div>

      {total > 0 && (
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={tr('Выполнено {{pct}}%', { pct })} className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <ul className="flex flex-col">
        {visible.map((i) => (
          <ItemRow key={i.id} item={i} canEdit={canEdit} onChanged={onChanged} onError={onError} />
        ))}
        {hideDone && done > 0 && <li className="px-1 py-1 text-xs text-muted-foreground">{tr('Скрыто выполненных:')}{' '}{done}</li>}
      </ul>

      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (adding.trim() && !addItems.isPending) addItems.mutate(adding)
          }}
        >
          <Input
            aria-label={tr('Новый пункт: {{title}}', { title: list.title })}
            placeholder={tr('Добавить пункт (можно вставить несколько строк)')}
            value={adding}
            maxLength={2000}
            onChange={(e) => setAdding(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (/\r?\n/.test(text.trim())) {
                e.preventDefault()
                addItems.mutate(text)
              }
            }}
          />
          <Button type="submit" variant="outline" disabled={!adding.trim() || addItems.isPending}>{tr('Добавить')}</Button>
        </form>
      )}
    </div>
  )
}

function ItemRow({
  item,
  canEdit,
  onChanged,
  onError,
}: {
  item: ChecklistItem
  canEdit: boolean
  onChanged: () => Promise<unknown>
  onError: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)

  const toggle = useMutation({
    mutationFn: (done: boolean) => run(supabase.from('checklist_items').update({ done }).eq('id', item.id)),
    onSuccess: onChanged,
    onError,
  })
  const edit = useMutation({
    mutationFn: (text: string) => run(supabase.from('checklist_items').update({ text }).eq('id', item.id)),
    onSuccess: async () => {
      setEditing(null)
      await onChanged()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: () => run(supabase.from('checklist_items').delete().eq('id', item.id)),
    onSuccess: onChanged,
    onError,
  })

  return (
    <li className="group flex min-h-11 items-center gap-2 rounded px-1 hover:bg-muted/40">
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-[var(--primary)]"
        checked={item.done}
        disabled={!canEdit || toggle.isPending}
        aria-label={item.text}
        onChange={(e) => toggle.mutate(e.target.checked)}
      />
      {editing !== null ? (
        <Input
          autoFocus
          aria-label={tr('Текст пункта')}
          className="h-9 flex-1"
          value={editing}
          maxLength={500}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => (editing.trim() && editing.trim() !== item.text ? edit.mutate(editing.trim()) : setEditing(null))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setEditing(item.text)}
          className={`min-w-0 flex-1 rounded px-1 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            item.done ? 'text-muted-foreground line-through' : ''
          }`}
        >
          {item.text}
        </button>
      )}
      {canEdit && editing === null && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="shrink-0 md:size-8 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
          aria-label={tr('Удалить пункт: {{text}}', { text: item.text })}
          title={tr('Удалить пункт')}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  )
}
