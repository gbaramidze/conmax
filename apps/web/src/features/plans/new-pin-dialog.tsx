import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LocationPicker } from '@/features/locations/location-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createTaskOnPlan } from '@/features/plans/api'
import type { PlanSpot } from '@/features/plans/plan-canvas'
import { projectMembersQuery } from '@/features/projects/api'
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from '@/features/tasks/api'

const NONE = '__none__'
const TYPES = ['punch', 'task', 'issue'] as const

/** Замечание в выбранной на плане точке: что не так, кому, к какому сроку. Место берётся из привязки плана к этажу. */
export function NewPinDialog({
  projectId,
  documentId,
  page,
  point,
  placeLabel,
  placeOptions,
  onClose,
  onCreated,
}: {
  projectId: string
  documentId: string
  page: number
  point: PlanSpot
  placeLabel: string | null
  /** Места, к которым привязан план: если их несколько (типовой этаж), нужно выбрать одно */
  placeOptions: { id: string; label: string }[]
  onClose: () => void
  onCreated: () => void
}) {
  const queryClient = useQueryClient()
  const { data: members } = useQuery(projectMembersQuery(projectId))
  const [title, setTitle] = useState('')
  const [type, setType] = useState<(typeof TYPES)[number]>('punch')
  const [assignee, setAssignee] = useState(NONE)
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState('normal')
  // у плана нет привязки к месту — выбираем место замечания прямо здесь
  const [locationId, setLocationId] = useState<string | null>(null)
  const needPlace = !placeLabel
  const choosePlace = placeOptions.length > 1
  const [chosenPlace, setChosenPlace] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createTaskOnPlan({
        projectId,
        documentId,
        page,
        x: point.x,
        y: point.y,
        x2: point.x2,
        y2: point.y2,
        title: title.trim(),
        type,
        assignee: assignee === NONE ? null : assignee,
        dueDate: due || null,
        priority,
        locationId: needPlace ? locationId : choosePlace ? chosenPlace : null,
      }),
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan-pins', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
      toast.success(tr('Создано {{key}}', { key: task.key }))
      onCreated()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : tr('Не удалось создать замечание.')),
  })

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{point.x2 !== undefined ? tr('Замечание на области плана') : tr('Замечание на плане')}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {choosePlace ? tr('План типовой: выберите этаж замечания ниже') : placeLabel ? tr('Место: {{placeLabel}}', { placeLabel }) : tr('План не привязан к месту: выберите место замечания ниже')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (title.trim() && !create.isPending) create.mutate()
          }}
        >
          {choosePlace && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-floor">{tr('Этаж замечания')}</Label>
              <Select value={chosenPlace} onValueChange={setChosenPlace}>
                <SelectTrigger id="pin-floor" className="w-full">
                  <SelectValue placeholder={tr('Выберите этаж')} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {placeOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {needPlace && (
            <div className="flex flex-col gap-2">
              <Label>{tr('Место замечания')}</Label>
              <LocationPicker projectId={projectId} value={locationId} onChange={setLocationId} placeholder={tr('Выберите этаж, секцию или помещение')} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pin-title">{tr('Что не так')}</Label>
            <Input id="pin-title" value={title} maxLength={300} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder={tr('Например, трещина в стяжке у окна')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-type">{tr('Тип')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof TYPES)[number])}>
                <SelectTrigger id="pin-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TASK_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-priority">{tr('Приоритет')}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="pin-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-assignee">{tr('Исполнитель')}</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="pin-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>{tr('Не назначен')}</SelectItem>
                  {(members ?? []).map((m) => (m.user ? <SelectItem key={m.user.id} value={m.user.id}>{m.user.full_name}</SelectItem> : null))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pin-due">{tr('Срок')}</Label>
              <DatePicker id="pin-due" value={due} onChange={(v) => setDue(v)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!title.trim() || create.isPending || (needPlace && !locationId) || (choosePlace && !chosenPlace)}>
              {create.isPending ? tr('Создаём…') : tr('Создать замечание')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
