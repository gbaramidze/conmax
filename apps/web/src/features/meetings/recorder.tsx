import { tr } from '@/lib/tr'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Mic, Pause, Play, Square, Trash2, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/features/activity/api'
import { useAuth } from '@/features/auth/auth-provider'
import { deleteMeetingRecording, meetingErrorText, participantsQuery, recordingsQuery, recordingUrl, saveMeetingRecording, transcribeChunk, transcriptPartsQuery, type MeetingDetail, type RecordingRow } from '@/features/meetings/api'
import { formatIn } from '@/features/meetings/time'

// Хранилище принимает файлы до 150 МБ; при 32 кбит/с это около десяти часов звука
const MAX_BYTES = 48 * 1024 * 1024
const BITS_PER_SECOND = 32_000
// Звук уходит на расшифровку короткими кусками: текст появляется по ходу, а итоги не ждут расшифровки всего файла
const CHUNK_MS = 30_000

interface LiveLine {
  seq: number
  offset: number
  speaker: string | null
  text: string
}

type Phase = 'idle' | 'recording' | 'paused' | 'saving' | 'failed'

const clock = (sec: number) => `${Math.floor(sec / 3600) > 0 ? Math.floor(sec / 3600) + ':' : ''}${String(Math.floor((sec % 3600) / 60)).padStart(Math.floor(sec / 3600) > 0 ? 2 : 1, '0')}:${String(sec % 60).padStart(2, '0')}`

function pickMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}
const extFor = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm')

/**
 * Запись звука совещания в браузере с телефона или компьютера. Файл сохраняется в закрытом хранилище и виден только
 * ведущему и управляющим совещанием. Расшифровка и итоги — отдельный шаг, позже.
 */
export function MeetingRecorder({ m, projectId, timezone, canRecord }: { m: MeetingDetail; projectId: string; timezone: string; canRecord: boolean }) {
  const queryClient = useQueryClient()
  const { tenantId } = useAuth()
  const { data: recordings } = useQuery(recordingsQuery(m.id, true))
  const open = m.status !== 'cancelled'
  const mayRecord = canRecord && m.status !== 'published' && open

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [pending, setPending] = useState<{ blob: Blob; name: string; durationSec: number; sessionId: string } | null>(null)
  const { data: people } = useQuery(participantsQuery(m.id))
  const [speaker, setSpeaker] = useState<string | null>(null)
  const [live, setLive] = useState<LiveLine[]>([])
  const [chunkCount, setChunkCount] = useState({ waiting: 0, failed: 0 })
  const { data: savedParts } = useQuery(transcriptPartsQuery(m.id, true))

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const bytes = useRef(0)
  const startedAt = useRef(0) // начало текущего отрезка записи
  const before = useRef(0) // секунд до последней паузы
  const audioCtx = useRef<AudioContext | null>(null)
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null)
  // расшифровка кусками: свой рекордер на том же микрофоне, перезапускается каждые 30 с и при смене говорящего
  const sessionId = useRef('')
  const mimeRef = useRef('')
  const chunkRec = useRef<MediaRecorder | null>(null)
  const chunkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chunkSeq = useRef(0)
  const speakerRef = useRef<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const liveBox = useRef<HTMLDivElement | null>(null)

  const supported = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

  // таймер и уровень сигнала
  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(() => setElapsed(before.current + Math.round((Date.now() - startedAt.current) / 1000)), 500)
    return () => clearInterval(t)
  }, [phase])

  // нельзя случайно закрыть страницу, пока запись идёт или не сохранена
  useEffect(() => {
    if (phase === 'idle') return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [phase])

  // выйти со страницы — значит освободить микрофон
  useEffect(
    () => () => {
      if (chunkTimer.current) clearTimeout(chunkTimer.current)
      releaseDevices()
    },
    [],
  )

  function releaseDevices() {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void audioCtx.current?.close().catch(() => undefined)
    audioCtx.current = null
    void wakeLock.current?.release().catch(() => undefined)
    wakeLock.current = null
    setLevel(0)
  }

  /** Секунд записи на сейчас (без пауз). */
  const nowSec = () => before.current + (startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0)

  function enqueueChunk(job: { seq: number; offsetSec: number; durationSec: number; speaker: string | null; blob: Blob }) {
    setChunkCount((c) => ({ ...c, waiting: c.waiting + 1 }))
    queue.current = queue.current.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const text = await transcribeChunk({ meetingId: m.id, sessionId: sessionId.current, ...job })
          if (text) setLive((l) => [...l, { seq: job.seq, offset: job.offsetSec, speaker: job.speaker, text }])
          setChunkCount((c) => ({ ...c, waiting: c.waiting - 1 }))
          return
        } catch {
          if (attempt === 2) setChunkCount((c) => ({ waiting: c.waiting - 1, failed: c.failed + 1 }))
          else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        }
      }
    })
  }

  function startChunk() {
    const media = stream.current
    if (!media || typeof MediaRecorder === 'undefined') return
    try {
      const r = new MediaRecorder(media, { ...(mimeRef.current ? { mimeType: mimeRef.current } : {}), audioBitsPerSecond: BITS_PER_SECOND })
      const parts: Blob[] = []
      const seq = chunkSeq.current++
      const offsetSec = nowSec()
      const startedMs = Date.now()
      const who = speakerRef.current
      r.ondataavailable = (e) => {
        if (e.data.size > 0) parts.push(e.data)
      }
      r.onstop = () => {
        const blob = new Blob(parts, { type: r.mimeType || mimeRef.current || 'audio/webm' })
        // совсем короткие обрывки (меньше секунды звука) не расшифровываем
        if (blob.size > 2500) enqueueChunk({ seq, offsetSec, durationSec: Math.max(1, Math.round((Date.now() - startedMs) / 1000)), speaker: who, blob })
      }
      r.start()
      chunkRec.current = r
      chunkTimer.current = setTimeout(rotateChunk, CHUNK_MS)
    } catch {
      /* расшифровка по ходу необязательна: полная запись идёт своим рекордером */
    }
  }

  /** Закрывает текущий кусок; возвращает обещание, которое выполнится, когда кусок попал в очередь. */
  function stopChunk(): Promise<void> {
    if (chunkTimer.current) clearTimeout(chunkTimer.current)
    chunkTimer.current = null
    const r = chunkRec.current
    chunkRec.current = null
    if (!r || r.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      r.addEventListener('stop', () => resolve(), { once: true })
      r.stop()
    })
  }

  function rotateChunk() {
    void stopChunk()
    startChunk()
  }

  function changeSpeaker(name: string | null) {
    speakerRef.current = name
    setSpeaker(name)
    // смена говорящего режет запись: прошлый кусок остаётся за прежним, новый — за новым
    if (chunkRec.current && chunkRec.current.state === 'recording') rotateChunk()
  }

  // новые реплики видны сразу: прокручиваем список вниз
  useEffect(() => {
    const el = liveBox.current
    if (el) el.scrollTop = el.scrollHeight
  }, [live])

  const save = useMutation({
    mutationFn: (rec: { blob: Blob; name: string; durationSec: number; sessionId: string }) =>
      saveMeetingRecording({ meetingId: m.id, projectId, tenantId: tenantId!, ...rec }),
    onSuccess: async () => {
      setPending(null)
      await queryClient.invalidateQueries({ queryKey: ['meeting-parts'] })
      setPhase('idle')
      setElapsed(0)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['meeting-recordings'] }), queryClient.invalidateQueries({ queryKey: ['activity'] })])
      toast.success(tr('Запись сохранена'))
    },
    onError: (e) => {
      setPhase('failed')
      toast.error(meetingErrorText(e, tr('Запись не загрузилась. Она сохранена в браузере: повторите загрузку или скачайте файл.')))
    },
  })

  async function start() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      stream.current = media
      const mime = pickMime()
      const rec = new MediaRecorder(media, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITS_PER_SECOND })
      chunks.current = []
      bytes.current = 0
      before.current = 0
      recorder.current = rec
      sessionId.current = crypto.randomUUID()
      mimeRef.current = mime
      chunkSeq.current = 0
      speakerRef.current = null
      queue.current = Promise.resolve()
      setSpeaker(null)
      setLive([])
      setChunkCount({ waiting: 0, failed: 0 })

      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return
        chunks.current.push(e.data)
        bytes.current += e.data.size
        if (bytes.current >= MAX_BYTES && rec.state !== 'inactive') {
          toast.message(tr('Достигнут предельный размер файла — запись сохраняется. Начните следующую часть.'))
          rec.stop()
        }
      }
      rec.onstop = async () => {
        // последний кусок и очередь расшифровки: не дольше 40 с, иначе сохраняем запись как есть
        await Promise.race([Promise.all([stopChunk(), queue.current]), new Promise((r) => setTimeout(r, 40_000))])
        const seconds = before.current + (rec.state === 'inactive' && startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0)
        const type = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        releaseDevices()
        const stamp = formatIn(new Date().toISOString(), timezone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[^\d]+/g, '-')
        const name = `${m.key} ${stamp}.${extFor(type)}`
        const rec2 = { blob, name, durationSec: Math.max(seconds, 1), sessionId: sessionId.current }
        setPending(rec2)
        setPhase('saving')
        save.mutate(rec2)
      }

      // индикатор уровня: видно, что микрофон действительно слышит
      try {
        const ctx = new AudioContext()
        audioCtx.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(media).connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const tick = () => {
          if (!audioCtx.current) return
          analyser.getByteTimeDomainData(data)
          let sum = 0
          for (const v of data) sum += ((v - 128) / 128) ** 2
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4))
          setTimeout(tick, 120)
        }
        tick()
      } catch {
        /* индикатор необязателен */
      }
      try {
        wakeLock.current = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null
      } catch {
        /* экран может погаснуть — запись продолжится, если браузер не заморозит вкладку */
      }

      startedAt.current = Date.now()
      rec.start(5000) // кусками по 5 с: ничего не копится в одном буфере и не теряется целиком
      startChunk()
      setElapsed(0)
      setPhase('recording')
    } catch (e) {
      releaseDevices()
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      toast.error(denied ? tr('Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера.') : tr('Не удалось включить микрофон.'))
    }
  }

  function pauseOrResume() {
    const rec = recorder.current
    if (!rec) return
    if (rec.state === 'recording') {
      rec.pause()
      void stopChunk()
      before.current += Math.round((Date.now() - startedAt.current) / 1000)
      startedAt.current = 0
      setPhase('paused')
    } else if (rec.state === 'paused') {
      rec.resume()
      startedAt.current = Date.now()
      startChunk()
      setPhase('recording')
    }
  }

  function stop() {
    const rec = recorder.current
    if (!rec || rec.state === 'inactive') return
    // секунды текущего отрезка добавляем до остановки: onstop прочитает итог
    if (rec.state === 'recording') {
      before.current += Math.round((Date.now() - startedAt.current) / 1000)
      startedAt.current = 0
    }
    rec.stop()
  }

  function downloadPending() {
    if (!pending) return
    const url = URL.createObjectURL(pending.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = pending.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  if (!open) return null
  if (!mayRecord && (recordings ?? []).length === 0) return null
  const active = phase === 'recording' || phase === 'paused'

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-soft" aria-label={tr('Запись звука')}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{tr('Запись звука')}</h2>
        {(recordings ?? []).length > 0 && <span className="text-xs text-muted-foreground">{recordings!.length}</span>}
      </div>

      {mayRecord && (
        <>
          <p className="-mt-1 text-xs text-muted-foreground">{tr('Запись видят только ведущий и организаторы. Предупредите участников, что идёт запись.')}</p>

          {!supported && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{tr('Запись работает только на защищённом соединении (https) или на самом компьютере по адресу localhost. С телефона по адресу вида 192.168… браузер микрофон не даст.')}</p>
          )}

          {supported && phase === 'idle' && (
            <Button className="w-fit" onClick={() => void start()}>
              <Mic />{tr('Записать звук')}</Button>
          )}

          {active && (
            <div className="flex flex-col gap-3 rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-3" role="status" aria-live="off">
                <span className={`size-3 rounded-full ${phase === 'recording' ? 'animate-pulse bg-red-600' : 'bg-muted-foreground'}`} aria-hidden />
                <span className="text-sm font-medium">{phase === 'recording' ? tr('Идёт запись') : tr('Пауза')}</span>
                <span className="text-lg font-semibold tabular-nums">{clock(elapsed)}</span>
                <span className="h-2 w-28 overflow-hidden rounded bg-muted" aria-label={tr('Уровень звука')}>
                  <span className="block h-full bg-green-600 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={pauseOrResume}>
                  {phase === 'recording' ? (
                    <>
                      <Pause />{tr('Пауза')}</>
                  ) : (
                    <>
                      <Play />{tr('Продолжить')}</>
                  )}
                </Button>
                <Button onClick={stop}>
                  <Square />{tr('Остановить и сохранить')}</Button>
              </div>
              {(people ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5" role="group" aria-label={tr('Кто говорит')}>
                  <span className="text-xs text-muted-foreground">{tr('Кто говорит (нажмите на имя, когда слово переходит к другому)')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {(people ?? [])
                      .filter((p) => p.user && p.attendance !== 'absent')
                      .map((p) => (
                        <button
                          key={p.user_id}
                          type="button"
                          aria-pressed={speaker === p.user!.full_name}
                          onClick={() => changeSpeaker(speaker === p.user!.full_name ? null : p.user!.full_name)}
                          className={`min-h-9 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${speaker === p.user!.full_name ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'}`}
                        >
                          {p.user!.full_name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">{tr('Расшифровка по ходу')}</h3>
                  <span className="text-xs text-muted-foreground" role="status">
                    {chunkCount.waiting > 0 ? tr('Расшифровываем…') : ''}
                    {chunkCount.failed > 0 ? ` ${tr('Не расшифровано кусков: {{n}}', { n: chunkCount.failed })}` : ''}
                  </span>
                </div>
                <div ref={liveBox} className="max-h-56 min-h-16 overflow-y-auto rounded-md border bg-card p-2 text-sm" aria-live="polite">
                  {live.length === 0 ? <p className="text-muted-foreground">{tr('Текст появится через полминуты после начала записи.')}</p> : <PartLines lines={live} />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{tr('Не закрывайте эту вкладку и не блокируйте экран, пока запись идёт.')}</p>
            </div>
          )}

          {!active && phase === 'idle' && (savedParts ?? []).length > 0 && (
            <details className="rounded-lg border bg-background p-3">
              <summary className="cursor-pointer text-sm font-medium">{tr('Расшифровка по ходу записи')}</summary>
              <div className="mt-2 max-h-72 overflow-y-auto text-sm">
                <PartLines lines={(savedParts ?? []).map((p) => ({ seq: p.seq, offset: p.offset_sec, speaker: p.speaker, text: p.text }))} />
              </div>
            </details>
          )}

          {phase === 'saving' && <p className="text-sm text-muted-foreground">{tr('Сохраняем запись')}{pending ? ` (${formatBytes(pending.blob.size)})` : ''}…</p>}

          {phase === 'failed' && pending && (
            <div className="flex flex-col gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3">
              <p className="text-sm">{tr('Запись не загрузилась, но осталась в браузере (')}{formatBytes(pending.blob.size)}{tr('). Не закрывайте страницу, пока не загрузите или не скачаете её.')}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setPhase('saving'); save.mutate(pending) }}>{tr('Повторить загрузку')}</Button>
                <Button variant="outline" onClick={downloadPending}>
                  <Download />{tr('Скачать на устройство')}</Button>
                <Button variant="ghost" onClick={() => { setPending(null); setPhase('idle') }}>{tr('Отбросить')}</Button>
              </div>
            </div>
          )}
        </>
      )}

      {(recordings ?? []).length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border bg-background">
          {recordings!.map((r) => (
            <RecordingItem key={r.id} r={r} timezone={timezone} canDelete={canRecord} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RecordingItem({ r, timezone, canDelete }: { r: RecordingRow; timezone: string; canDelete: boolean }) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const load = useMutation({
    mutationFn: () => recordingUrl(r.file!.storage_key),
    onSuccess: setUrl,
    onError: () => toast.error(tr('Не удалось открыть запись.')),
  })
  const remove = useMutation({
    mutationFn: () => deleteMeetingRecording(r.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['meeting-recordings'] })
      toast.success(tr('Запись удалена'))
    },
    onError: (e) => toast.error(meetingErrorText(e, tr('Не удалось удалить запись.'))),
  })

  return (
    <li className="flex flex-col gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Volume2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 text-sm">
          {formatIn(r.created_at, timezone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {clock(r.duration_sec)}
          {r.file && <span className="text-xs text-muted-foreground"> · {formatBytes(r.file.size_bytes)}</span>}
          {r.creator && <span className="text-xs text-muted-foreground"> · {r.creator.full_name}</span>}
        </span>
        {!url && (
          <Button size="sm" variant="outline" disabled={load.isPending || !r.file} onClick={() => load.mutate()}>
            <Play />{tr('Прослушать')}</Button>
        )}
        {url && (
          <Button asChild size="sm" variant="ghost">
            <a href={url} download={r.file?.name}>
              <Download />{tr('Скачать')}</a>
          </Button>
        )}
        {canDelete &&
          (confirming ? (
            <>
              <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{tr('Удалить запись')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{tr('Не удалять')}</Button>
            </>
          ) : (
            <Button size="icon" variant="ghost" className="size-8" aria-label={tr('Удалить запись')} onClick={() => setConfirming(true)}>
              <Trash2 />
            </Button>
          ))}
      </div>
      {url && <audio controls autoPlay src={url} className="w-full" />}
    </li>
  )
}

/** Реплики по порядку: время от начала записи, говорящий (если отмечен) и текст. */
function PartLines({ lines }: { lines: LiveLine[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {lines.map((l, i) => (
        <li key={`${l.seq}-${i}`} className="flex gap-2">
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{clock(l.offset)}</span>
          <span className="min-w-0">
            {l.speaker && <span className="font-medium">{l.speaker}: </span>}
            {l.text}
          </span>
        </li>
      ))}
    </ul>
  )
}
