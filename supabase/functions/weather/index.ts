// Воркер погоды: для каждого проекта с координатами забирает прогноз Open-Meteo (без ключа) и сохраняет по дням.
// Вызывается из БД (pg_cron → pg_net) с секретом в заголовке x-worker-secret.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SECRET = Deno.env.get('EMAIL_WORKER_SECRET') ?? 'dev-worker-secret'

interface Daily {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  precipitation_sum: number[]
  wind_speed_10m_max: number[]
  wind_gusts_10m_max: number[]
}

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== SECRET) return new Response('forbidden', { status: 403 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: places, error } = await supabase.rpc('weather_places')
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let done = 0
  const failed: string[] = []
  for (const p of (places ?? []) as { project_id: string; lat: number; lon: number }[]) {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
        '&wind_speed_unit=ms&past_days=7&forecast_days=14&timezone=auto'
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`open-meteo ${res.status}`)
      const d = (await res.json()).daily as Daily
      const rows = d.time.map((day, i) => ({
        day,
        code: d.weather_code[i],
        tmax: d.temperature_2m_max[i],
        tmin: d.temperature_2m_min[i],
        precip: d.precipitation_sum[i],
        wind: d.wind_speed_10m_max[i],
        gust: d.wind_gusts_10m_max[i],
      }))
      const { error: e } = await supabase.rpc('weather_store', { p_project: p.project_id, p_rows: rows })
      if (e) throw e
      done++
    } catch (e) {
      failed.push(`${p.project_id}: ${(e as Error).message}`)
    }
  }
  return new Response(JSON.stringify({ done, failed }), { headers: { 'Content-Type': 'application/json' } })
})
