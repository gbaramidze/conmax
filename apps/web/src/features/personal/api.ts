import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface PersonalItem {
  id: string
  kind: 'note' | 'event'
  title: string
  body: string
  event_date: string | null
  start_time: string | null
  end_time: string | null
  place: string | null
  pinned: boolean
  /** участники события: им уходит приглашение письмом с вашей почты */
  attendees: { name: string; address: string }[]
  /** версия приглашения: растёт при каждом изменении события с участниками */
  invite_seq: number
  invited_at: string | null
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, kind, title, body, event_date, start_time, end_time, place, pinned, attendees, invite_seq, invited_at, created_at, updated_at'

/** Заметки владельца: закреплённые сверху, затем по свежести правки. Чужие заметки база не отдаёт. */
export const personalNotesQuery = queryOptions({
  queryKey: ['personal', 'notes'],
  queryFn: async () => {
    const { data, error } = await supabase.from('personal_items').select(COLUMNS).eq('kind', 'note').order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(500)
    if (error) throw error
    return data as unknown as PersonalItem[]
  },
})

export const personalItemQuery = (id: string) =>
  queryOptions({
    queryKey: ['personal', 'item', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('personal_items').select(COLUMNS).eq('id', id).maybeSingle()
      if (error) throw error
      return data as unknown as PersonalItem | null
    },
  })

export interface PersonalInput {
  id?: string
  kind: 'note' | 'event'
  title: string
  body: string
  event_date?: string | null
  start_time?: string | null
  end_time?: string | null
  place?: string | null
  pinned?: boolean
  attendees?: { name: string; address: string }[]
  invite_seq?: number
}

/** Сохраняет запись и возвращает её id (нужен, чтобы сразу отправить приглашение на новое событие). */
export async function savePersonalItem(v: PersonalInput): Promise<string> {
  const fields = {
    title: v.title.trim(),
    body: v.body,
    event_date: v.event_date ?? null,
    start_time: v.start_time || null,
    end_time: v.start_time ? v.end_time || null : null,
    place: v.place?.trim() || null,
    pinned: v.pinned ?? false,
    ...(v.attendees ? { attendees: v.attendees } : {}),
    ...(v.invite_seq !== undefined ? { invite_seq: v.invite_seq } : {}),
  }
  if (v.id) {
    const { error } = await supabase.from('personal_items').update(fields as never).eq('id', v.id)
    if (error) throw error
    return v.id
  }
  const { data, error } = await supabase.from('personal_items').insert({ kind: v.kind, ...fields } as never).select('id').single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function deletePersonalItem(id: string): Promise<void> {
  const { error } = await supabase.from('personal_items').delete().eq('id', id)
  if (error) throw error
}
