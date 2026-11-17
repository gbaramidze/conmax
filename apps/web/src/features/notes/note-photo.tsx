import { queryOptions, useQuery } from '@tanstack/react-query'
import { signedUrlQuery } from '@/features/activity/api'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/** Первое фото заметки (по id заметки = id её комментария). Нет фото — null. */
export const notePhotoQuery = (noteId: string) =>
  queryOptions({
    queryKey: ['note-photo', noteId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attachments')
        .select('created_at, file:files!inner(storage_key, mime, status)')
        .eq('comment_id', noteId)
        .like('file.mime', 'image/%')
        .eq('file.status', 'ready')
        .order('created_at')
        .limit(1)
      if (error) throw error
      const file = (data?.[0] as unknown as { file: { storage_key: string } } | undefined)?.file
      return file?.storage_key ?? null
    },
  })

/** Миниатюра первого фото заметки в уведомлении; пока нет фото (или оно грузится) — ничего не занимает. */
export function NotePhotoThumb({ noteId, className }: { noteId: string; className?: string }) {
  const { data: key } = useQuery(notePhotoQuery(noteId))
  const { data: url } = useQuery({ ...signedUrlQuery(key ?? ''), enabled: !!key })
  if (!key || !url) return null
  return <img src={url} alt="" loading="lazy" className={cn('shrink-0 rounded-md border bg-muted object-cover', className ?? 'size-14')} />
}
