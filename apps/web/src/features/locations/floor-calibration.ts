/** Один замер положения телефона. */
export interface Fix {
  alt: number | null
  altAcc: number | null
  posAcc: number
}

/** Итог серии замеров на месте: высота (медиана), разброс (10–90 процентиль) и сколько замеров дали высоту. */
export interface Reading {
  alt: number
  spread: number
  altAcc: number | null
  n: number
  at: string
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

/** Сводка серии замеров; пусто, если телефон высоту не отдаёт. */
export function summarize(fixes: Fix[]): Reading | null {
  const alts = fixes.map((f) => f.alt).filter((a): a is number => a !== null && Number.isFinite(a))
  if (alts.length < 3) return null
  const accs = fixes.map((f) => f.altAcc).filter((a): a is number => a !== null && Number.isFinite(a))
  return { alt: median(alts), spread: pct(alts, 0.9) - pct(alts, 0.1), altAcc: accs.length ? median(accs) : null, n: alts.length, at: new Date().toISOString() }
}

/** Собирает замеры заданное время; отменяется ошибкой, если нет разрешения или геолокация недоступна. */
export function collectFixes(ms: number, onTick?: (elapsedMs: number, count: number) => void): Promise<Fix[]> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'))
    const fixes: Fix[] = []
    const t0 = Date.now()
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      navigator.geolocation.clearWatch(id)
      clearInterval(timer)
      fn()
    }
    const id = navigator.geolocation.watchPosition(
      (p) => fixes.push({ alt: p.coords.altitude, altAcc: p.coords.altitudeAccuracy, posAcc: p.coords.accuracy }),
      (e) => finish(() => reject(e)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    const timer = setInterval(() => {
      const el = Date.now() - t0
      onTick?.(el, fixes.length)
      if (el >= ms) finish(() => resolve(fixes))
    }, 500)
  })
}

export interface Candidate {
  id: string
  alt: number
  /** Расстояние по высоте от текущего замера, м */
  diff: number
}

export type Verdict = 'confident' | 'unsure'

/** Ближайший откалиброванный этаж по высоте и насколько ему можно верить: разрыв до второго кандидата должен заметно превышать шум замеров. */
export function locate(now: Reading, saved: Record<string, Reading>): { best: Candidate; ranked: Candidate[]; verdict: Verdict } | null {
  const ranked = Object.entries(saved)
    .map(([id, r]) => ({ id, alt: r.alt, diff: Math.abs(now.alt - r.alt) }))
    .sort((a, b) => a.diff - b.diff)
  if (ranked.length === 0) return null
  const best = ranked[0]
  const noise = Math.max(2, now.spread + (saved[best.id]?.spread ?? 0))
  const gap = ranked.length > 1 ? ranked[1].diff - best.diff : Infinity
  return { best, ranked, verdict: gap >= 1.5 * noise && best.diff <= noise ? 'confident' : 'unsure' }
}

/** Годится ли способ на этом телефоне: расстояние между соседними этажами по высоте против шума замеров. */
export function suitability(floorsInOrder: string[], saved: Record<string, Reading>): { minGap: number; maxSpread: number; ok: boolean } | null {
  const alts = floorsInOrder.filter((id) => saved[id]).map((id) => ({ alt: saved[id].alt, spread: saved[id].spread }))
  if (alts.length < 2) return null
  const sorted = [...alts].sort((a, b) => a.alt - b.alt)
  let minGap = Infinity
  for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i].alt - sorted[i - 1].alt)
  const maxSpread = Math.max(...alts.map((a) => a.spread))
  return { minGap, maxSpread, ok: minGap >= 2 * Math.max(maxSpread, 1) }
}
