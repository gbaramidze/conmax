import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/features/auth/auth-provider'
import { createMeeting, createMeetingSeries, MEETING_TYPE_LABELS, meetingErrorText, WEEKDAY_LONG, type MeetingType, type SeriesSlot } from '@/features/meetings/api'
import { defaultStart, isoDow, zonedToIso } from '@/features/meetings/time'
import { projectMembersQuery } from '@/features/projects/api'

export function CreateMeetingDialog({ projectId, code, timezone, initialDate, onClose }: { projectId: string; code: string; timezone: string; /** день «YYYY-MM-DD» из календаря; время по умолчанию — 10:00 */ initialDate?: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { session } = useAuth()
  const me = session?.user.id
  const { data: members } = useQuery(projectMembersQuery(projectId))

  const [title, setTitle] = useState('')
  const [type, setType] = useState<MeetingType>('weekly')
  const [start, setStart] = useState(() => (initialDate ? `${initialDate}T10:00` : defaultStart(timezone)))
  const [duration, setDuration] = useState('60')
  const [place, setPlace] = useState('')
  const [external, setExternal] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [agenda, setAgenda] = useState('')
  // регулярное совещание: дни недели со временем (пн 11:00, ср 13:00), даты начала и окончания серии
  const [repeat, setRepeat] = useState(false)
  const [slots, setSlots] = useState<SeriesSlot[]>([])
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')

  function toggleRepeat(on: boolean) {
    setRepeat(on)
    if (on && slots.length === 0) {
      setSlots([{ dow: isoDow(start), time: start.slice(11, 16) }])
      setStartsOn(start.slice(0, 10))
    }
  }
  const patchSlot = (i: number, patch: Partial<SeriesSlot>) => setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const candidates = (members ?? []).filter((m) => m.user && m.user.id !== me)
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const create = useMutation({
    mutationFn: async () => {
      const common = {
        projectId,
        title: title.trim(),
        type,
        durationMin: Math.max(5, Number(duration) || 60),
        place: place.trim(),
        visibility: external ? ('external' as const) : ('internal' as const),
        facilitator: null,
        participants: [...picked],
        agenda: agenda.split('\n').map((s) => s.trim()).filter(Boolean),
      }
      if (repeat) {
        await createMeetingSeries({ ...common, slots, startsOn, endsOn: endsOn || null })
        return null
      }
      return createMeeting({ ...common, scheduledAt: zonedToIso(start, timezone) })
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['meetings', projectId] })
      onClose()
      if (id) {
        toast.success(tr('Совещание создано, участники уведомлены'))
        await navigate({ to: '/projects/$code/meeting/$id', params: { code, id } })
      } else {
        toast.success(tr('Серия создана: ближайшие встречи появились в списке, участники уведомлены'))
      }
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось создать совещание. Попробуйте ещё раз.'))),
  })

  const valid = title.trim().length > 0 && (repeat ? slots.length > 0 && slots.every((s) => s.time) && startsOn.length > 0 : start.length > 0)

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr('Новое совещание')}</DialogTitle>
          <DialogDescription>{tr('Время указывается по часовому поясу проекта (')}{timezone}{tr('). Приглашённые получат уведомление.')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !create.isPending) create.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="m-title">{tr('Тема')}</Label>
            <Input id="m-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={tr('Например, планёрка по бетонированию')} autoFocus />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="m-type">{tr('Вид')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as MeetingType)}>
                <SelectTrigger id="m-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MEETING_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!repeat && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="m-start">{tr('Начало')}</Label>
                <Input id="m-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="m-dur">{tr('Длительность, мин')}</Label>
              <Input id="m-dur" type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="m-place">{tr('Место или ссылка')}</Label>
              <Input id="m-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} placeholder={tr('Бытовка, переговорная, ссылка на звонок')} />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <label className="flex min-h-9 items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={repeat} onChange={(e) => toggleRepeat(e.target.checked)} />
              <span>{tr('Повторять каждую неделю')}<span className="block text-xs text-muted-foreground">{tr('Например, понедельник в 11:00 и среда в 13:00. Встречи создаются заранее, любую можно перенести.')}</span>
              </span>
            </label>
            {repeat && (
              <>
                <ul className="flex flex-col gap-2" aria-label={tr('Дни и время')}>
                  {slots.map((s, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Select value={String(s.dow)} onValueChange={(v) => patchSlot(i, { dow: Number(v) })}>
                        <SelectTrigger size="sm" aria-label={tr('День недели')} className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAY_LONG.map((name, j) => (
                            <SelectItem key={name} value={String(j + 1)}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input aria-label={tr('Время начала')} type="time" className="h-8 w-32" value={s.time} onChange={(e) => patchSlot(i, { time: e.target.value })} />
                      {slots.length > 1 && (
                        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={tr('Убрать день')} onClick={() => setSlots((prev) => prev.filter((_, j) => j !== i))}>
                          <X />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {slots.length < 7 && (
                  <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={() => setSlots((prev) => [...prev, { dow: 1, time: '11:00' }])}>
                    <Plus />{tr('Ещё день')}</Button>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="m-from">{tr('Начало серии')}</Label>
                    <DatePicker id="m-from" value={startsOn} onChange={(v) => setStartsOn(v)} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="m-to">{tr('Конец серии (необязательно)')}</Label>
                    <DatePicker id="m-to" value={endsOn} min={startsOn} onChange={(v) => setEndsOn(v)} />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{tr('Участники')}</Label>
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
              {candidates.map((m) => (
                <li key={m.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted/50">
                    <input type="checkbox" className="size-4" checked={picked.has(m.user!.id)} onChange={() => toggle(m.user!.id)} />
                    <span className="min-w-0 flex-1 truncate">{m.user!.full_name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{m.role?.name}</span>
                  </label>
                </li>
              ))}
              {candidates.length === 0 && <li className="p-2 text-sm text-muted-foreground">{tr('В проекте пока нет других участников.')}</li>}
            </ul>
            <p className="text-xs text-muted-foreground">{tr('Вы и ведущий входите в состав автоматически.')}</p>
          </div>

          <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={external} onChange={(e) => setExternal(e.target.checked)} />
            <span>{tr('Совещание с внешними участниками')}<span className="block text-xs text-muted-foreground">{tr('Приглашённые подрядчики и заказчик увидят повестку, а решения и поручения — после публикации протокола.')}</span>
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <Label htmlFor="m-agenda">{tr('Повестка (по пункту на строку)')}</Label>
            <Textarea id="m-agenda" rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder={tr('Итоги прошлой недели\nГрафик бетонирования\nВопросы подрядчиков')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              {create.isPending ? tr('Создаём…') : repeat ? tr('Создать серию') : tr('Создать совещание')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
