import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryOptions } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { locationLabel, locationsQuery } from '@/features/locations/api'
import { LocationPicker } from '@/features/locations/location-picker'
import { supabase } from '@/lib/supabase'

interface TemplateItem {
  title: string
  offset_days?: number
  priority?: string
}
interface Template {
  id: string
  name: string
  description: string | null
  items: TemplateItem[]
}

const templatesQuery = queryOptions({
  queryKey: ['task-templates'],
  staleTime: 5 * 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.from('task_templates').select('id, name, description, items').is('deleted_at', null).order('name')
    if (error) throw error
    return data as unknown as Template[]
  },
})

/** Создать набор типовых задач сразу на несколько мест (например, «Приёмка этажа» на 12 этажей). */
export function TemplateDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: templates } = useQuery(templatesQuery)
  const { data: locations } = useQuery(locationsQuery(projectId))
  const [templateId, setTemplateId] = useState('')
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [start, setStart] = useState(() => new Date().toLocaleDateString('sv'))

  const template = templates?.find((t) => t.id === templateId)
  const total = template ? template.items.length * locationIds.length : 0

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('apply_task_template', { p_project: projectId, p_template: templateId, p_locations: locationIds, p_start: start })
      if (error) throw error
      return data as number
    },
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      toast.success(tr('Создано задач: {{n}}', { n }))
      onClose()
    },
    onError: (e) => toast.error((e as { code?: string }).code === '42501' ? tr('У вас нет права создавать задачи в этом проекте.') : tr('Не удалось создать задачи. Попробуйте ещё раз.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Задачи из шаблона')}</DialogTitle>
          <DialogDescription>{tr('Набор типовых задач создаётся на каждое выбранное место со сроками от даты старта.')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tpl">{tr('Шаблон')}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="tpl" className="w-full">
                <SelectValue placeholder={tr('Выберите шаблон')} />
              </SelectTrigger>
              <SelectContent>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {t.items.length}{tr('зад.')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {template && (
              <ul className="mt-1 flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                {template.description && <li className="mb-1 text-sm">{template.description}</li>}
                {template.items.map((it, i) => (
                  <li key={i}>
                    +{it.offset_days ?? 0}{tr('дн. ·')}{' '}{it.title.replace('{место}', '…')}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Места')}</Label>
            {locationIds.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {locationIds.map((id) => {
                  const loc = locations?.find((l) => l.id === id)
                  return (
                    <li key={id} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 text-xs">
                      <span className="ident">{loc?.path}</span>
                      <span className="text-muted-foreground">{loc && locations ? locationLabel(loc.path, locations) : ''}</span>
                      <Button type="button" size="icon" variant="ghost" className="size-6" aria-label={tr('Убрать место')} onClick={() => setLocationIds((p) => p.filter((x) => x !== id))}>
                        <X />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <LocationPicker
              projectId={projectId}
              value={null}
              placeholder={locationIds.length > 0 ? tr('Добавить ещё место') : tr('Выбрать этаж, секцию или помещение')}
              onChange={(id) => setLocationIds((p) => (p.includes(id) || p.length >= 60 ? p : [...p, id]))}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tpl-start">{tr('Дата старта')}</Label>
            <DatePicker id="tpl-start" value={start} onChange={(v) => setStart(v)} className="sm:w-48" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={apply.isPending} onClick={onClose}>{tr('Отмена')}</Button>
          <Button disabled={!templateId || locationIds.length === 0 || !start || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? tr('Создаём…') : total > 0 ? tr('Создать задач: {{total}}', { total }) : tr('Создать')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
