import { queryOptions } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { LocationRow } from '@/features/locations/api'
import type { ConvertedStorey, ConvertProgress } from './ifc-convert'
import type { WorkerOut } from './ifc-worker'

/**
 * 3D-модель здания проекта (миграция 171). Файл — GLB, сжатый gzip (`.glb.gz`), собранный из IFC (features/model/ifc-convert.ts:
 * в браузере при загрузке IFC или скриптом scripts/model/ifc-to-glb.mjs): по узлу на этаж IFC, в extras сцены — список этажей.
 * Этажи модели сопоставляются с местами структуры. Старые модели могли лежать несжатым `.glb` — читаются оба вида.
 */
export const MODELS_BUCKET = 'models'

export interface ModelStorey {
  gid: string
  name: string
  /** отметка этажа из IFC, м */
  elevation: number
  /** уровень пола в координатах модели, м */
  y: number
  sort: number
  location_id: string | null
}

export interface ProjectModel {
  id: string
  storage_key: string
  file_name: string
  size_bytes: number
  spaces: number
  created_at: string
  storeys: ModelStorey[]
}

export const projectModelQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-model', projectId],
    queryFn: async (): Promise<ProjectModel | null> => {
      const { data, error } = await supabase
        .from('project_models')
        .select('id, storage_key, file_name, size_bytes, spaces, created_at, storeys:project_model_storeys(gid, name, elevation, y, sort, location_id)')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const storeys = (data.storeys ?? []).map((s) => ({ ...s, elevation: Number(s.elevation), y: Number(s.y) })).sort((a, b) => a.sort - b.sort)
      return { ...data, storeys }
    },
  })

export interface FloorStats {
  location_id: string
  tasks_open: number
  tasks_overdue: number
  notes_open: number
}

export const modelFloorStatsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project-model', projectId, 'stats'],
    queryFn: async (): Promise<FloorStats[]> => {
      const { data, error } = await supabase.rpc('model_floor_stats', { p_project: projectId })
      if (error) throw error
      return data ?? []
    },
  })

/**
 * Сам файл модели. Хранится в кэше браузера (Cache API) по ключу файла: дом в 10–20 МБ скачивается один раз,
 * дальше раздел открывается сразу. Новая версия модели — новый ключ, старая запись просто перестаёт читаться.
 */
export const modelFileQuery = (storageKey: string | undefined) =>
  queryOptions({
    queryKey: ['project-model-file', storageKey ?? ''],
    enabled: !!storageKey,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async (): Promise<ArrayBuffer> => {
      const cacheKey = `/__model/${encodeURIComponent(storageKey!)}`
      const cache = typeof caches !== 'undefined' ? await caches.open('project-models-v1').catch(() => null) : null
      const hit = await cache?.match(cacheKey).catch(() => undefined)
      if (hit) return hit.arrayBuffer()
      const { data: blob, error } = await supabase.storage.from(MODELS_BUCKET).download(storageKey!)
      if (error || !blob) throw error ?? new Error('download')
      const buf = storageKey!.endsWith('.gz') ? await gunzip(blob) : await blob.arrayBuffer()
      void cache?.put(cacheKey, new Response(buf, { headers: { 'Content-Type': 'model/gltf-binary' } })).catch(() => undefined)
      return buf
    },
  })

type GlbStorey = ConvertedStorey

/** Этажи и число помещений из extras сцены GLB (читается только JSON-часть файла, без геометрии). */
export function readGlbInfo(buf: ArrayBuffer): { storeys: GlbStorey[]; spaces: number } {
  const view = new DataView(buf)
  if (buf.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not_glb')
  const jsonLength = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('not_glb')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLength))) as {
    extras?: { buildos?: number; storeys?: GlbStorey[]; spaces?: unknown[] }
    scenes?: { extras?: { buildos?: number; storeys?: GlbStorey[]; spaces?: unknown[] } }[]
  }
  const extras = json.extras?.buildos ? json.extras : json.scenes?.[0]?.extras
  if (!extras?.buildos || !Array.isArray(extras.storeys) || extras.storeys.length === 0) throw new Error('not_buildos_glb')
  return { storeys: extras.storeys, spaces: Array.isArray(extras.spaces) ? extras.spaces.length : 0 }
}

/** Готовая к загрузке модель: сжатый GLB и то, что о нём нужно базе */
export interface PreparedModel {
  gz: Uint8Array
  fileName: string
  storeys: ConvertedStorey[]
  spaces: number
}

export type PreparePhase = 'read' | ConvertProgress['stage']

const gunzip = (data: Blob | Uint8Array) =>
  new Response((data instanceof Blob ? data : new Blob([data as BlobPart])).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
const gzipBytes = async (data: ArrayBuffer) =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())

export const isIfcFile = (f: File) => /.ifc(zip)?$/i.test(f.name)

/** IFC или IFCZIP → модель: перевод идёт в фоновом потоке (ifc-worker.ts), страница не замирает */
export function convertIfcFile(file: File, onProgress: (phase: PreparePhase, done: number) => void): Promise<PreparedModel> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ifc-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'read') onProgress('read', m.done)
      else if (m.type === 'progress') onProgress(m.stage, m.done)
      else {
        worker.terminate()
        if (m.type === 'done') resolve({ gz: m.result.glbGz, fileName: file.name.replace(/.ifc(zip)?$/i, '.glb'), storeys: m.result.storeys, spaces: m.result.spaces })
        else reject(new Error(m.message))
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'worker_failed'))
    }
    worker.postMessage({ file })
  })
}

/** Готовый .glb или .glb.gz (переведённый скриптом) → модель */
export async function prepareGlbFile(file: File): Promise<PreparedModel> {
  const raw = await file.arrayBuffer()
  const gzipped = new Uint8Array(raw, 0, 2)
  const isGz = gzipped[0] === 0x1f && gzipped[1] === 0x8b
  const glb = isGz ? await gunzip(new Uint8Array(raw)) : raw
  const info = readGlbInfo(glb)
  return { gz: isGz ? new Uint8Array(raw) : await gzipBytes(glb), fileName: file.name.replace(/.gz$/i, ''), storeys: info.storeys, spaces: info.spaces }
}

/** Загрузить модель и сделать её действующей моделью проекта; возвращает id модели. */
export async function uploadModel(tenantId: string, projectId: string, m: PreparedModel): Promise<string> {
  const key = `${tenantId}/${projectId}/${crypto.randomUUID()}.glb.gz`
  const { error: upErr } = await supabase.storage.from(MODELS_BUCKET).upload(key, new Blob([m.gz as BlobPart]), { contentType: 'application/octet-stream', upsert: false })
  if (upErr) throw upErr
  const { data, error } = await supabase.rpc('model_register', {
    p_project: projectId,
    p_key: key,
    p_file_name: m.fileName,
    p_size: m.gz.byteLength,
    p_spaces: m.spaces,
    p_storeys: m.storeys.map((s) => ({ gid: s.gid, name: s.name, elevation: s.elevation, y: s.y })),
  })
  if (error) throw error
  return data as string
}

export async function setModelStoreys(modelId: string, items: { gid: string; location_id: string | null }[]) {
  const { error } = await supabase.rpc('model_set_storeys', { p_model: modelId, p_items: items })
  if (error) throw error
}

/**
 * Подсказка сопоставления этажей модели с этажами структуры. Номер берётся из названия этажа IFC
 * («25. Story» → 25, «3-4 typical» → 3, «Ground Floor» → 1); этажи без номера между двумя найденными
 * продолжают счёт по порядку («story» после «25. Story» → 26). Подземные и технические этажи без номера не трогаем.
 */
export function suggestStoreyMapping(storeys: ModelStorey[], locations: LocationRow[]): Record<string, string | null> {
  const floors = locations.filter((l) => l.kind === 'floor')
  const byNumber = new Map<number, LocationRow>()
  for (const f of floors) {
    const n = floorNumber(f)
    if (n !== null && !byNumber.has(n)) byNumber.set(n, f)
  }
  const ordered = [...storeys].sort((a, b) => a.elevation - b.elevation)
  const numbers: (number | null)[] = ordered.map((s) => storeyNumber(s.name))
  const explicit = new Set(numbers.filter((n): n is number => n !== null))
  // без номера, но сразу над этажом с номером на типовой высоте — следующий номер, если такого номера нет у другого этажа
  // («story» над «25. Story» → 26; «Antresol» над «Ground Floor» не станет 2-м, потому что есть «2. Story»)
  for (let i = 1; i < ordered.length; i++) {
    if (numbers[i] !== null || numbers[i - 1] === null || numbers[i - 1]! < 2) continue
    const step = ordered[i].elevation - ordered[i - 1].elevation
    const next = numbers[i - 1]! + 1
    if (step >= 2.5 && step <= 5 && !explicit.has(next)) numbers[i] = next
  }
  const out: Record<string, string | null> = {}
  const used = new Set<string>()
  ordered.forEach((s, i) => {
    const n = numbers[i]
    const loc = n !== null ? byNumber.get(n) : undefined
    if (loc && !used.has(loc.id)) {
      out[s.gid] = loc.id
      used.add(loc.id)
    } else out[s.gid] = null
  })
  return out
}

function storeyNumber(name: string): number | null {
  const n = name.trim().toLowerCase()
  if (/^(ground floor|first floor|1st floor|первый этаж)$/.test(n)) return 1
  if (/^-/.test(n)) return null
  const m = n.match(/^(\d{1,3})\s*(?:[.\-–]|st|nd|rd|th|\s|$)/)
  return m ? Number(m[1]) : null
}

function floorNumber(f: LocationRow): number | null {
  const m = f.code.match(/^F0*(\d{1,3})$/i) ?? f.name.match(/(\d{1,3})\s*$/)
  return m ? Number(m[1]) : null
}
