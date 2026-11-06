import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FILES_BUCKET, uploadProjectFile } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { supabase } from '@/lib/supabase'

const MAX_COVER_BYTES = 25 * 1024 * 1024

/** Ссылка на фото из закрытого хранилища живёт час; в кэше держим меньше, чтобы не показать просроченную. */
function useCoverUrl(storageKey: string | null | undefined) {
  return useQuery({
    queryKey: ['project-cover', storageKey],
    enabled: !!storageKey,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storageKey!, 3600)
      if (error || !data) throw error ?? new Error('no url')
      return data.signedUrl
    },
  })
}

/** Фото проекта; без фото — графитовая плашка с кодом, как на знаке проекта. */
export function ProjectCover({ storageKey, code, name, className = '' }: { storageKey?: string | null; code: string; name: string; className?: string }) {
  const { data: url } = useCoverUrl(storageKey)
  if (storageKey && url) {
    return <img src={url} alt={tr('Фото проекта «{{name}}»', { name })} loading="lazy" className={`size-full object-cover ${className}`} />
  }
  return (
    <div className={`flex size-full items-center justify-center bg-primary ${className}`} aria-hidden={!storageKey}>
      <span className="ident text-2xl font-medium tracking-wide text-signal">{code}</span>
    </div>
  )
}

/** Кнопки «Добавить/сменить фото» и «Убрать». Фото сжимается до 1600 px, как и остальные снимки. */
export function CoverControls({ projectId, hasCover, className = '' }: { projectId: string; hasCover: boolean; className?: string }) {
  const queryClient = useQueryClient()
  const { tenantId } = useAuth()
  const input = useRef<HTMLInputElement>(null)

  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['project-cover'] })])

  const set = useMutation({
    mutationFn: async (file: File | null) => {
      let fileId: string | null = null
      if (file) fileId = await uploadProjectFile(projectId, tenantId!, file)
      const { error } = await supabase.rpc('set_project_cover', { p_project: projectId, p_file: fileId as never })
      if (error) throw error
    },
    onSuccess: async (_, file) => {
      await refresh()
      toast.success(file ? tr('Фото проекта обновлено') : tr('Фото проекта убрано'))
    },
    onError: (e) => {
      const m = (e as { message?: string; statusCode?: string; code?: string }) ?? {}
      const denied = m.code === '42501' || m.statusCode === '403' || /row-level security|permission denied|Unauthorized/i.test(m.message ?? '')
      toast.error(denied ? tr('Нет права менять фото этого проекта: загружать его могут руководитель проекта и администратор организации.') : tr('Не удалось сохранить фото{{v1}}. Проверьте файл и попробуйте ещё раз.', { v1: m.message ? `: ${m.message}` : '' }))
    },
  })

  return (
    <div className={`flex gap-2 ${className}`}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (input.current) input.current.value = ''
          if (!f) return
          if (!f.type.startsWith('image/')) return void toast.error(tr('Выберите изображение: JPG, PNG или WebP.'))
          if (f.size > MAX_COVER_BYTES) return void toast.error(tr('Фото больше 25 МБ не загрузить.'))
          set.mutate(f)
        }}
      />
      <Button type="button" size="sm" variant="secondary" disabled={set.isPending} onClick={() => input.current?.click()}>
        <ImagePlus /> {set.isPending ? tr('Загружаем…') : hasCover ? tr('Сменить фото') : tr('Добавить фото')}
      </Button>
      {hasCover && (
        <Button type="button" size="sm" variant="secondary" disabled={set.isPending} onClick={() => set.mutate(null)} aria-label={tr('Убрать фото проекта')}>
          <Trash2 />{tr('Убрать')}</Button>
      )}
    </div>
  )
}
