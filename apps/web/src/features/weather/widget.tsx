import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, MapPin, Sun, Wind } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cityFromAddress, clearProjectGeo, findPlaces, geoQuery, setProjectGeo, weatherFlags, weatherKind, weatherQuery, weatherText, type Place, type WeatherKind } from './api'

const ICONS: Record<WeatherKind, typeof Sun> = { clear: Sun, partly: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning }
const dow = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', day: 'numeric' })
const deg = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n)}°`)

/** Погода на объекте: сегодня и ближайшая неделя; условия, мешающие работам, отмечены. */
export function WeatherWidget({ projectId, address, canEdit }: { projectId: string; address: string | null; canEdit: boolean }) {
  const { data: geo, isLoading } = useQuery(geoQuery(projectId))
  const { data: days = [] } = useQuery({ ...weatherQuery(projectId), enabled: !!geo })
  const [editing, setEditing] = useState(false)
  const today = new Date().toLocaleDateString('sv')
  const week = days.filter((d) => d.day >= today).slice(0, 7)
  const updated = days[0]?.fetched_at

  if (isLoading) return null
  if (!geo) {
    if (!canEdit) return null
    return (
      <section aria-labelledby="weather" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-soft">
        <div>
          <h2 id="weather" className="text-sm font-semibold">{tr('Погода на объекте')}</h2>
          <p className="text-sm text-muted-foreground">{tr('Укажите место объекта, и здесь появится прогноз на неделю. Он же попадёт в журнал дня и предупредит о ветре и морозе.')}</p>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          <MapPin />{tr('Указать место')}</Button>
        {editing && <GeoDialog projectId={projectId} address={address} current={null} onClose={() => setEditing(false)} />}
      </section>
    )
  }

  return (
    <section aria-labelledby="weather" className="rounded-lg border bg-card p-4 shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="weather" className="text-sm font-semibold">{tr('Погода на объекте')}{' '}{geo.place && <span className="font-normal text-muted-foreground">· {geo.place}</span>}
        </h2>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{tr('Изменить место')}</button>
        )}
      </div>
      {week.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr('Прогноз загружается: он появится в течение нескольких минут.')}</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {week.map((d, i) => {
            const Icon = ICONS[weatherKind(d.code)]
            const flags = weatherFlags(d)
            return (
              <li key={d.day} className={`flex flex-col items-center gap-1 rounded-md border p-2 text-center ${flags.length > 0 ? 'border-amber-500/60 bg-amber-500/10' : ''}`} title={[weatherText(d.code), ...flags].join('; ')}>
                <span className="text-xs text-muted-foreground">{i === 0 ? tr('Сегодня') : dow.format(new Date(`${d.day}T00:00:00`))}</span>
                <Icon className="size-6 text-muted-foreground" aria-label={weatherText(d.code)} />
                <span className="text-sm font-semibold tabular-nums">{deg(d.tmax)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{deg(d.tmin)}</span>
                <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
                  <Wind className="size-3" aria-hidden /> {d.wind === null ? '—' : Math.round(d.wind)}
                </span>
                {(d.precip ?? 0) >= 0.5 && <span className="text-xs tabular-nums text-blue-700 dark:text-blue-300">{Math.round(d.precip!)}{tr('мм')}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {week.some((d) => weatherFlags(d).length > 0) && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{tr('Выделены дни, когда погода мешает работам:')}{' '}{[...new Set(week.flatMap(weatherFlags))].slice(0, 3).join('; ')}.
        </p>
      )}
      {updated && <p className="mt-2 text-xs text-muted-foreground">{tr('Данные Open-Meteo, обновлено')}{' '}{new Date(updated).toLocaleString(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{tr('. Ветер — макс. за сутки, м/с.')}</p>}
      {editing && <GeoDialog projectId={projectId} address={address} current={geo} onClose={() => setEditing(false)} />}
    </section>
  )
}

function GeoDialog({ projectId, address, current, onClose }: { projectId: string; address: string | null; current: { lat: number; lon: number; place: string | null } | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [query, setQuery] = useState(cityFromAddress(address))
  const [found, setFound] = useState<Place[] | null>(null)
  const [lat, setLat] = useState(current ? String(current.lat) : '')
  const [lon, setLon] = useState(current ? String(current.lon) : '')
  const [place, setPlace] = useState(current?.place ?? '')
  const [busy, setBusy] = useState(false)

  const search = async () => {
    setBusy(true)
    try {
      setFound(await findPlaces(query.trim()))
    } catch {
      toast.error(tr('Не удалось найти место. Введите координаты вручную.'))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      await setProjectGeo(projectId, Number(lat.replace(',', '.')), Number(lon.replace(',', '.')), place)
      await qc.invalidateQueries({ queryKey: ['weather'] })
      toast.success(tr('Место сохранено. Прогноз появится в течение нескольких минут.'))
      onClose()
    } catch {
      toast.error(tr('Не удалось сохранить место. Проверьте координаты.'))
      setBusy(false)
    }
  }
  const ok = Number.isFinite(Number(lat.replace(',', '.'))) && Number.isFinite(Number(lon.replace(',', '.'))) && lat.trim() !== '' && lon.trim() !== ''

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('Место объекта')}</DialogTitle>
          <DialogDescription>{tr('Для прогноза погоды нужны координаты. Найдите населённый пункт или введите координаты точки объекта.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="geo-q">{tr('Город или посёлок')}</Label>
              <Input id="geo-q" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void search())} />
            </div>
            <Button type="button" variant="outline" className="self-end" disabled={busy || query.trim().length < 2} onClick={search}>{tr('Найти')}</Button>
          </div>
          {found && (
            <ul className="flex flex-col divide-y rounded-lg border">
              {found.length === 0 && <li className="p-3 text-sm text-muted-foreground">{tr('Ничего не найдено.')}</li>}
              {found.map((p) => (
                <li key={`${p.lat}${p.lon}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => {
                      setLat(String(p.lat))
                      setLon(String(p.lon))
                      setPlace([p.name, p.region].filter(Boolean).join(', '))
                    }}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{[p.region, p.country].filter(Boolean).join(', ')} · {p.lat.toFixed(3)}, {p.lon.toFixed(3)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="geo-lat">{tr('Широта')}</Label>
              <Input id="geo-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="55.7887" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="geo-lon">{tr('Долгота')}</Label>
              <Input id="geo-lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="49.1221" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="geo-place">{tr('Название места')}</Label>
            <Input id="geo-place" value={place} maxLength={200} onChange={(e) => setPlace(e.target.value)} placeholder={tr('Например, Казань, ул. Заречная')} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {current ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await clearProjectGeo(projectId)
                  await qc.invalidateQueries({ queryKey: ['weather'] })
                  onClose()
                } catch {
                  toast.error(tr('Не удалось убрать место.'))
                  setBusy(false)
                }
              }}
            >{tr('Убрать место')}</Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{tr('Отмена')}</Button>
            <Button type="button" disabled={busy || !ok} onClick={save}>{tr('Сохранить')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
