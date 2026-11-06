import { tr } from '@/lib/tr'
import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface WeatherDay {
  day: string
  code: number | null
  tmax: number | null
  tmin: number | null
  precip: number | null
  wind: number | null
  gust: number | null
  fetched_at: string
}
export interface Geo {
  lat: number
  lon: number
  place: string | null
}

export const geoQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weather', 'geo', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('project_geo').select('lat, lon, place').eq('project_id', projectId).maybeSingle()
      if (error) throw error
      return data ? ({ lat: Number(data.lat), lon: Number(data.lon), place: data.place } as Geo) : null
    },
  })

export const weatherQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['weather', 'days', projectId],
    refetchInterval: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_weather')
        .select('day, code, tmax, tmin, precip, wind, gust, fetched_at')
        .eq('project_id', projectId)
        .order('day')
        .limit(40)
      if (error) throw error
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
      return (data as unknown as WeatherDay[]).map((d) => ({ ...d, tmax: n(d.tmax), tmin: n(d.tmin), precip: n(d.precip), wind: n(d.wind), gust: n(d.gust) }))
    },
  })

export async function setProjectGeo(projectId: string, lat: number, lon: number, place: string): Promise<void> {
  const { error } = await supabase.rpc('set_project_geo', { p_project: projectId, p_lat: lat, p_lon: lon, p_place: place })
  if (error) throw error
}
export async function clearProjectGeo(projectId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_project_geo', { p_project: projectId })
  if (error) throw error
}

export interface Place {
  name: string
  region: string
  country: string
  lat: number
  lon: number
}

/** Поиск населённого пункта по названию (геокодер Open-Meteo, без ключа). */
export async function findPlaces(query: string): Promise<Place[]> {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=ru&format=json`)
  if (!res.ok) throw new Error('geocoding')
  const json = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] }
  return (json.results ?? []).map((r) => ({ name: r.name, region: r.admin1 ?? '', country: r.country ?? '', lat: r.latitude, lon: r.longitude }))
}

/** Название города из адреса вида «г. Казань, ул. Заречная, 7». */
export function cityFromAddress(address: string | null | undefined): string {
  if (!address) return ''
  const part = address.split(',').map((s) => s.trim()).find((s) => /^(г\.|город|пос\.|п\.|с\.)/i.test(s)) ?? address.split(',')[0]
  return part.replace(/^(г\.|город|пос\.|п\.|с\.)\s*/i, '').trim()
}

const CODES: Record<number, string> = {
  0: tr('Ясно'), 1: tr('Преимущественно ясно'), 2: tr('Переменная облачность'), 3: tr('Пасмурно'), 45: tr('Туман'), 48: tr('Изморозь'),
  51: tr('Слабая морось'), 53: tr('Морось'), 55: tr('Сильная морось'), 56: tr('Ледяная морось'), 57: tr('Ледяная морось'),
  61: tr('Небольшой дождь'), 63: tr('Дождь'), 65: tr('Сильный дождь'), 66: tr('Ледяной дождь'), 67: tr('Ледяной дождь'),
  71: tr('Небольшой снег'), 73: tr('Снег'), 75: tr('Сильный снег'), 77: tr('Снежная крупа'), 80: tr('Ливень'), 81: tr('Ливень'), 82: tr('Сильный ливень'),
  85: tr('Снегопад'), 86: tr('Сильный снегопад'), 95: tr('Гроза'), 96: tr('Гроза с градом'), 99: tr('Гроза с градом'),
}
export const weatherText = (code: number | null) => (code === null ? '—' : (CODES[code] ?? tr('Без данных')))
export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'
export function weatherKind(code: number | null): WeatherKind {
  if (code === null) return 'cloud'
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'partly'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'cloud'
}

/** Условия, мешающие работам: ветер для кранов, ливень, мороз для бетона, жара. */
export function weatherFlags(d: WeatherDay): string[] {
  const out: string[] = []
  if ((d.gust ?? 0) >= 15) out.push(tr('порывы {{v1}} м/с — краны', { v1: Math.round(d.gust!) }))
  if ((d.precip ?? 0) >= 15) out.push(tr('осадки {{v1}} мм', { v1: Math.round(d.precip!) }))
  if ((d.tmin ?? 99) <= -5) out.push(tr('мороз {{v1}}° — бетон', { v1: Math.round(d.tmin!) }))
  if ((d.tmax ?? -99) >= 35) out.push(tr('жара {{v1}}°', { v1: Math.round(d.tmax!) }))
  return out
}

/** Строка для журнала дня: «Пасмурно, ветер до 3 м/с, осадки 2 мм». */
export function weatherSummary(d: WeatherDay): string {
  return [weatherText(d.code), d.wind !== null ? tr('ветер до {{v1}} м/с', { v1: Math.round(d.wind) }) : null, (d.precip ?? 0) > 0 ? tr('осадки {{precip}} мм', { precip: d.precip }) : null].filter(Boolean).join(', ')
}
