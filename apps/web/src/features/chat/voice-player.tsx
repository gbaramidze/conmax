import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tr } from '@/lib/tr'
import { cn } from '@/lib/utils'

const BARS = 42
const RATES = [1, 1.5, 2] as const

const peaksCache = new Map<string, number[]>()
/** Одновременно играет одно голосовое: следующее останавливает предыдущее. Выбранная скорость запоминается на время сеанса. */
let playingNow: HTMLAudioElement | null = null
let savedRate: (typeof RATES)[number] = 1

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** Запасная волна, пока файл не разобран (или браузер не умеет его декодировать): стабильный «узор» по ключу файла. */
function fallbackPeaks(seed: string): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return Array.from({ length: BARS }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return 0.2 + 0.6 * (((h ^ (h >>> 16)) >>> 0) / 4294967295)
  })
}

/** Высота столбиков волны по громкости записи: корень из среднего модуля сигнала на отрезке, нормированный по самому громкому. */
async function computePeaks(buffer: ArrayBuffer): Promise<number[] | null> {
  try {
    const ctx = new AudioContext()
    const audio = await ctx.decodeAudioData(buffer.slice(0))
    void ctx.close()
    const data = audio.getChannelData(0)
    const block = Math.floor(data.length / BARS)
    if (block < 1) return null
    const raw: number[] = []
    for (let i = 0; i < BARS; i++) {
      let sum = 0
      let n = 0
      for (let j = i * block; j < (i + 1) * block; j += 8) {
        sum += Math.abs(data[j]!)
        n += 1
      }
      raw.push(n ? sum / n : 0)
    }
    const max = Math.max(...raw, 1e-6)
    return raw.map((v) => Math.max(0.12, Math.sqrt(v / max)))
  } catch {
    return null // например, Safari не декодирует opus в webm — остаётся запасная волна
  }
}

/**
 * Голосовое сообщение как в мессенджерах: кнопка «играть», волна с прогрессом (по ней можно перематывать),
 * время и переключатель скорости 1× → 1,5× → 2×.
 */
export function VoicePlayer({ url, id, durationSec, mine }: { url: string | undefined; id: string; durationSec: number | null; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [src, setSrc] = useState<string>()
  const [peaks, setPeaks] = useState<number[]>(() => peaksCache.get(id) ?? fallbackPeaks(id))
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(durationSec ?? 0)
  const [rate, setRate] = useState<(typeof RATES)[number]>(savedRate)

  // файл скачивается один раз: из него и звук, и волна
  useEffect(() => {
    if (!url) return
    let alive = true
    let objectUrl: string | undefined
    const abort = new AbortController()
    fetch(url, { signal: abort.signal })
      .then((r) => r.blob())
      .then(async (blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (alive) setSrc(objectUrl)
        if (!peaksCache.has(id)) {
          const decoded = await computePeaks(await blob.arrayBuffer())
          if (decoded) {
            peaksCache.set(id, decoded)
            if (alive) setPeaks(decoded)
          }
        }
      })
      .catch(() => {
        if (alive) setSrc(url) // не вышло скачать целиком — играем по ссылке без волны
      })
    return () => {
      alive = false
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, id])

  // плавный прогресс, пока играет
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const el = audioRef.current
      if (el) setPosition(el.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  useEffect(
    () => () => {
      if (playingNow === audioRef.current) playingNow = null
    },
    [],
  )

  const total = duration > 0 && Number.isFinite(duration) ? duration : (durationSec ?? 0)
  const fraction = total > 0 ? Math.min(position / total, 1) : 0

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      if (playingNow && playingNow !== el) playingNow.pause()
      playingNow = el
      el.playbackRate = rate
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }

  const seekTo = (ratio: number) => {
    const el = audioRef.current
    if (!el || total <= 0) return
    el.currentTime = Math.min(Math.max(ratio, 0), 1) * total
    setPosition(el.currentTime)
  }

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!
    savedRate = next
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const bars = useMemo(() => peaks, [peaks])
  const played = mine ? 'bg-primary-foreground' : 'bg-foreground'
  const unplayed = mine ? 'bg-primary-foreground/40' : 'bg-foreground/25'

  return (
    <div className="flex w-64 max-w-full items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPosition(0)
          if (audioRef.current) audioRef.current.currentTime = 0
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          if (Number.isFinite(el.duration)) setDuration(el.duration)
          else {
            // запись с микрофона в браузере без длительности в заголовке: заставляем плеер её посчитать, иначе перемотка не работает
            el.currentTime = 1e101
            el.addEventListener(
              'timeupdate',
              () => {
                if (Number.isFinite(el.duration)) setDuration(el.duration)
                el.currentTime = 0
              },
              { once: true },
            )
          }
        }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? tr('Пауза') : tr('Слушать голосовое сообщение')}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          mine ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
        )}
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          role="slider"
          tabIndex={0}
          aria-label={tr('Перемотка голосового сообщения')}
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${clock(position)} / ${clock(total)}`}
          onPointerDown={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            seekTo((e.clientX - box.left) / box.width)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seekTo((position + 5) / total)
            if (e.key === 'ArrowLeft') seekTo((position - 5) / total)
          }}
          className="flex h-8 cursor-pointer touch-pan-y items-center gap-[2px] rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {bars.map((peak, i) => (
            <span key={i} aria-hidden className={cn('w-[3px] flex-1 rounded-full', (i + 0.5) / BARS <= fraction ? played : unplayed)} style={{ height: `${Math.round(peak * 100)}%` }} />
          ))}
        </div>
        <span className={cn('text-[11px] tabular-nums', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{clock(playing || position > 0 ? position : total)}</span>
      </div>

      <button
        type="button"
        onClick={cycleRate}
        aria-label={tr('Скорость воспроизведения: {{rate}}×', { rate })}
        title={tr('Скорость воспроизведения')}
        className={cn(
          'h-7 min-w-11 shrink-0 rounded-full border px-2 text-xs font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring',
          mine ? 'border-primary-foreground/40 hover:bg-primary-foreground/10' : 'border-foreground/20 hover:bg-background',
        )}
      >
        {String(rate).replace('.', ',')}×
      </button>
    </div>
  )
}
