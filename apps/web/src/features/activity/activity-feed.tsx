import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import type { JSONContent } from '@tiptap/react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Camera, Lock, Paperclip } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  commentsQuery,
  eventsQuery,
  MAX_FILE_BYTES,
  postComment,
  type EntityRef,
} from '@/features/activity/api'
import { AttachmentThumb } from '@/features/activity/attachment-thumb'
import { CommentBody } from '@/features/activity/comment-body'
import { CommentEditor } from '@/features/activity/comment-editor'
import { PickedFile } from '@/features/activity/picked-file'
import { describeEvent } from '@/features/activity/event-text'
import { useAuth } from '@/features/auth/auth-provider'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { UserAvatar } from '@/features/profile/avatar'
import { myPermissionsQuery, tenantUsersQuery } from '@/features/projects/api'
import { reasonCodesQuery } from '@/features/tasks/api'
import { supabase } from '@/lib/supabase'

const dateTime = new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' })

type Filter = 'all' | 'comments' | 'changes'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: tr('Все') },
  { value: 'comments', label: tr('Комментарии') },
  { value: 'changes', label: tr('Изменения') },
]

/** Обновляет ленту при любых изменениях комментариев, событий и вложений проекта (Supabase Realtime, RLS применяется). */
function useFeedRealtime(projectId: string) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] })
      void queryClient.invalidateQueries({ queryKey: ['attachments'] })
    }
    const channel = supabase.channel(`feed:${projectId}`)
    for (const table of ['comments', 'entity_events', 'attachments']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `project_id=eq.${projectId}` }, refresh)
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [projectId, queryClient])
}

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as JSONContent

export function ActivityFeed({
  entity,
  projectId,
  title = tr('Обсуждение и история'),
  placeholder = tr('Напишите комментарий. @ — упомянуть коллегу'),
}: {
  entity: EntityRef
  projectId: string
  title?: string
  placeholder?: string
}) {
  useFeedRealtime(projectId)
  const [filter, setFilter] = useState<Filter>('all')

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`activity-title-${entity.type}`}>
      <h2 id={`activity-title-${entity.type}`} className="text-lg font-semibold">
        {title}
      </h2>
      <Composer entity={entity} projectId={projectId} placeholder={placeholder} />
      <div role="group" aria-label={tr('Что показывать')} className="flex gap-1">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? 'secondary' : 'ghost'}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <Feed entity={entity} filter={filter} projectId={projectId} />
    </section>
  )
}

function Composer({ entity, projectId, placeholder }: { entity: EntityRef; projectId: string; placeholder: string }) {
  const { tenantId } = useAuth()
  const queryClient = useQueryClient()
  const { data: permissions } = useSuspenseQuery(myPermissionsQuery(projectId))
  const canInternal = permissions.includes('comment.internal.create')
  const canExternal = permissions.includes('comment.create')

  const [doc, setDoc] = useState<JSONContent | null>(null)
  const [isEmpty, setIsEmpty] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const [forExternal, setForExternal] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  // Без права на внутренние комментарии пишем только «внешние»
  const visibility = !canInternal || forExternal ? 'external' : 'internal'

  const post = useMutation({
    mutationFn: () =>
      // фото без текста тоже допустимо: пустой абзац
      postComment({ entity, projectId, tenantId: tenantId!, body: doc ?? EMPTY_DOC, visibility, files }),
    onSuccess: async ({ failedFiles }) => {
      setResetKey((k) => k + 1)
      setDoc(null)
      setIsEmpty(true)
      setFiles([])
      await queryClient.invalidateQueries({ queryKey: ['activity'] })
      await queryClient.invalidateQueries({ queryKey: ['attachments'] })
      if (failedFiles.length > 0) {
        toast.error(tr('Комментарий опубликован, но не удалось прикрепить: {{v1}}', { v1: failedFiles.join(', ') }))
      }
    },
    onError: () => toast.error(tr('Не удалось отправить комментарий. Текст сохранён в поле — попробуйте ещё раз.')),
  })

  if (!canExternal && !canInternal) {
    return <p className="text-sm text-muted-foreground">{tr('У вас нет права комментировать этот проект.')}</p>
  }

  const hasContent = !isEmpty || files.length > 0
  const submit = () => {
    if (hasContent && !post.isPending) post.mutate()
  }

  function addFiles(list: FileList | null, input: React.RefObject<HTMLInputElement | null> = fileInput) {
    if (!list) return
    const picked = Array.from(list)
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES)
    if (tooBig.length > 0) toast.error(tr('Файл больше 150 МБ не загрузить: {{v1}}', { v1: tooBig.map((f) => f.name).join(', ') }))
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)])
    if (input.current) input.current.value = ''
  }

  return (
    <div className="flex flex-col gap-2">
      <CommentEditor
        placeholder={placeholder}
        ariaLabel={tr('Новый комментарий')}
        resetKey={resetKey}
        onChange={(d, empty) => {
          setDoc(d)
          setIsEmpty(empty)
        }}
        onSubmit={submit}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-3 pt-1">
          {files.map((f, i) => (
            <PickedFile key={`${f.name}-${i}`} file={f} onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          {/* capture: на телефоне сразу открывается камера */}
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addFiles(e.target.files, cameraInput)} />
          <Button type="button" variant="ghost" size="sm" onClick={() => cameraInput.current?.click()}>
            <Camera />{tr('Снять')}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
            <Paperclip />{tr('Файл')}</Button>
          {canInternal && canExternal && (
            <div className="flex min-h-11 items-center gap-2 md:min-h-0">
              <input
                id="for-external"
                type="checkbox"
                className="size-5 md:size-4"
                checked={forExternal}
                onChange={(e) => setForExternal(e.target.checked)}
              />
              <Label htmlFor="for-external" className="font-normal">{tr('Показать подрядчикам и заказчику')}</Label>
            </div>
          )}
        </div>
        <Button className="max-sm:w-full" onClick={submit} disabled={!hasContent || post.isPending} title="Ctrl+Enter">{tr('Отправить')}</Button>
      </div>
    </div>
  )
}

function Feed({ entity, filter, projectId }: { entity: EntityRef; filter: Filter; projectId: string }) {
  const { data: comments } = useSuspenseQuery(commentsQuery(entity))
  const { data: events } = useSuspenseQuery(eventsQuery(entity))
  const { data: users } = useQuery(tenantUsersQuery)

  const { data: reasons } = useQuery(reasonCodesQuery)
  const { data: locations } = useQuery(locationsQuery(projectId))
  const locationNames = useMemo(
    () => new Map((locations ?? []).map((l) => [l.id, locationLabel(l.path, locations ?? [])])),
    [locations],
  )

  const eventContext = useMemo(() => {
    const names = new Map((users ?? []).map((u) => [u.id, u.full_name]))
    const reasonNames = new Map((reasons ?? []).map((r) => [r.code, r.name]))
    return {
      userName: (id: string) => names.get(id) ?? tr('участник'),
      reasonName: (code: string) => reasonNames.get(code) ?? code,
      locationName: (id: string) => locationNames.get(id) ?? tr('локация'),
    }
  }, [users, reasons, locationNames])

  const items = useMemo(() => {
    const list = [
      ...(filter !== 'changes' ? comments.map((c) => ({ kind: 'comment' as const, at: c.created_at, c })) : []),
      ...(filter !== 'comments' ? events.map((e) => ({ kind: 'event' as const, at: e.occurred_at, e })) : []),
    ]
    return list.sort((a, b) => b.at.localeCompare(a.at))
  }, [comments, events, filter])

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{tr('Пока пусто. Первый комментарий задаст тон обсуждению.')}</p>
  }

  return (
    <ol className="flex flex-col gap-4">
      {items.map((item) =>
        item.kind === 'comment' ? (
          <li key={`c-${item.c.id}`} className="flex flex-col gap-2 rounded-lg border bg-card p-3.5 shadow-soft">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <UserAvatar name={item.c.author?.full_name ?? '?'} path={item.c.author?.avatar_path} className="size-6 text-[10px]" />
              <span className="font-medium">{item.c.author?.full_name}</span>
              <time className="text-muted-foreground" dateTime={item.c.created_at}>
                {dateTime.format(new Date(item.c.created_at))}
              </time>
              {item.c.edited_at && <span className="text-xs text-muted-foreground">{tr('изменён')}</span>}
              {item.c.visibility === 'internal' && (
                <Badge variant="outline" className="gap-1">
                  <Lock className="size-3" />{tr('Только команда')}</Badge>
              )}
            </div>
            <CommentBody doc={item.c.body} />
            {item.c.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {item.c.attachments.map((a) =>
                  a.file ? (
                    <li key={a.id}>
                      <AttachmentThumb file={a.file} />
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </li>
        ) : (
          <li key={`e-${item.e.id}`} className="flex flex-wrap items-baseline gap-2 px-1 text-sm text-muted-foreground">
            <span aria-hidden>•</span>
            <span>
              {item.e.actor?.full_name ? `${item.e.actor.full_name}: ` : ''}
              {describeEvent(item.e.event_type, item.e.changes as Record<string, unknown>, eventContext)}
            </span>
            <time dateTime={item.e.occurred_at} className="text-xs">
              {dateTime.format(new Date(item.e.occurred_at))}
            </time>
          </li>
        ),
      )}
    </ol>
  )
}
