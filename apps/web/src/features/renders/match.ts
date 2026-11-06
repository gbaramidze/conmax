import type { LocationRow } from '@/features/locations/api'
import type { ImageEntity, ProjectImage } from '@/features/renders/api'

/** Куда кладётся изображение: место структуры или тип номера. */
export interface Target extends ImageEntity {
  label: string
}

export interface PickedFile {
  file: File
  /** Путь внутри выбранной папки: «Rotana/Этаж 4/401/ночь.jpg» → ['Rotana', 'Этаж 4', '401'] (без имени файла) */
  dirs: string[]
  /** Номер ревизии среди соседних папок «… 01.1», «… 01.2» (0 — самая старая); у файлов не из ревизий пусто */
  rank?: number
}

/** Название папки-ревизии: «JUNIOR SUITE 01.2» → основа «JUNIOR SUITE», номер [1, 2]. «Junior Suite 1» ревизией не считается (нет точки и приставки v / rev). */
const REVISION = /^(.*?)[\s._-]*((?:v|ver|rev|r|версия|ревизия)[\s._-]*\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/i
export function parseRevision(name: string): { base: string; nums: number[] } | null {
  const m = REVISION.exec(name.trim())
  if (!m || !m[1]!.trim()) return null
  return { base: m[1]!.trim().toLowerCase().replace(/\s+/g, ' '), nums: (m[2]!.match(/\d+/g) ?? []).map(Number) }
}
const compareNums = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

export interface RevisionGroup {
  /** Папка, в которую лягут сведённые изображения (общий родитель; пусто — корень) */
  parent: string
  /** Общее название ревизий */
  base: string
  /** Полные пути папок-ревизий от старой к новой */
  folders: string[]
}

/** Соседние папки-ревизии («… 01.1», «… 01.2» в одной папке): две и больше с одним названием. */
export function revisionGroups(paths: string[]): RevisionGroup[] {
  const groups = new Map<string, { parent: string; base: string; items: { path: string; nums: number[] }[] }>()
  for (const path of new Set(paths)) {
    const cut = path.lastIndexOf('/')
    const parent = cut < 0 ? '' : path.slice(0, cut)
    const rev = parseRevision(cut < 0 ? path : path.slice(cut + 1))
    if (!rev) continue
    const key = `${parent}|${rev.base}`
    const g = groups.get(key) ?? { parent, base: rev.base, items: [] }
    g.items.push({ path, nums: rev.nums })
    groups.set(key, g)
  }
  return [...groups.values()]
    .filter((g) => g.items.length >= 2)
    .map((g) => ({ parent: g.parent, base: g.base, folders: g.items.sort((x, y) => compareNums(x.nums, y.nums)).map((i) => i.path) }))
}

/**
 * Файлы из соседних папок-ревизий («JUNIOR SUITE 01.1», «… 01.2») считаем одним набором: папка-ревизия убирается из пути,
 * а файлу ставится номер ревизии. Одноимённые файлы разных ревизий потом станут версиями одного изображения, новейшая — текущая.
 */
export function markRevisions(picked: PickedFile[]): PickedFile[] {
  const prefixes = new Set<string>()
  for (const p of picked) for (let i = 0; i < p.dirs.length; i++) prefixes.add(p.dirs.slice(0, i + 1).join('/'))
  const rank = new Map<string, number>()
  for (const g of revisionGroups([...prefixes])) g.folders.forEach((f, i) => rank.set(f, i))
  if (rank.size === 0) return picked
  return picked.map((p) => {
    for (let i = 0; i < p.dirs.length; i++) {
      const r = rank.get(p.dirs.slice(0, i + 1).join('/'))
      if (r !== undefined) return { ...p, dirs: [...p.dirs.slice(0, i), ...p.dirs.slice(i + 1)], rank: r }
    }
    return p
  })
}

/** Сравнимое написание названия: без регистра, префиксов «Номер», «Room» и лишних знаков («Номер 401» = «401» = «room-401»). */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/^(номер|помещение|квартира|комната|этаж|room|apt|apartment|floor|level|no|№)[\s._-]*/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Название файла без расширения и без хвоста версии: «спальня_v2.jpg» и «спальня.jpg» — один рендер. */
export function renderBase(fileName: string): string {
  return fileName
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .replace(/[\s._-]*(v|ver|version|в|версия)[\s._-]*\d+$/i, '')
    .replace(/[\s._-]*\(\d+\)$/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export interface Places {
  rows: LocationRow[]
  types: { id: string; name: string }[]
}

export interface Match {
  target: Target | null
  /** Папка внутри места: сегменты пути, не ушедшие на выбор места */
  folder: string[]
}

const pathIndex = new WeakMap<LocationRow[], Map<string, LocationRow>>()
export const locationTarget = (r: LocationRow, rows: LocationRow[]): Target => {
  let byPath = pathIndex.get(rows)
  if (!byPath) {
    byPath = new Map(rows.map((x) => [x.path, x]))
    pathIndex.set(rows, byPath)
  }
  const parts = r.path.split('.')
  const label = parts.map((_, i) => byPath.get(parts.slice(0, i + 1).join('.'))?.name ?? '').filter(Boolean).slice(-2).join(' › ')
  return { type: 'location', id: r.id, label }
}

/**
 * Находит тип номера или место по путям папок и имени файла.
 * Рендеры номеров обычно одинаковы у всех номеров одного типа, поэтому сначала ищется ТИП НОМЕРА («STANDARD KING 2»), а из мест
 * автоматически берутся только корпус, секция, этаж и зона. Отдельную комнату программа сама не назначает: её выбирают вручную.
 * Слева направо: название папки или файла совпало — берём это, более глубокое совпадение важнее; если подходящих несколько, не гадаем.
 * Всё, что осталось от пути после найденного, становится папкой в галерее.
 */
export function matchPlace(places: Places, dirs: string[], fileName: string): Match {
  let scope: LocationRow | null = null
  let target: Target | null = null
  let lastMatched = -1
  const segments = [...dirs, fileName]
  for (let i = 0; i < segments.length; i++) {
    const key = norm(segments[i]!)
    if (!key) continue
    const types = places.types.filter((x) => norm(x.name) === key)
    if (types.length === 1) {
      target = { type: 'room_type', id: types[0]!.id, label: types[0]!.name }
      lastMatched = i
      continue
    }
    const inScope = places.rows.filter((r) => r.kind !== 'room' && (scope ? r.path.startsWith(`${scope.path}.`) : true))
    const found = inScope.filter((r) => norm(r.name) === key || norm(r.code) === key)
    if (found.length === 1) {
      scope = found[0]!
      target = locationTarget(scope, places.rows)
      lastMatched = i
    }
  }
  // имя файла само не бывает папкой; от пути остаются сегменты после последнего совпадения (корень без совпадений отбрасываем)
  const rest = dirs.slice(lastMatched >= 0 ? Math.min(lastMatched + 1, dirs.length) : 1)
  return { target, folder: rest }
}

export interface PlannedFile {
  /** Файлы по порядку от старого к новому: ревизии одного рендера. Последний станет текущим. */
  files: File[]
  /** Изображение места, у которого эти файлы — новые версии (совпали название и папка); пусто — новое изображение */
  versionOf: string | null
}

export interface Group {
  /** Ключ группы: что выбрано и в какую папку */
  key: string
  /** Откуда: путь исходной папки */
  source: string
  target: Target | null
  folder: string
  files: PickedFile[]
}

/** Группы по исходной папке: файлы одной папки идут в одно место, пока пользователь не переназначит. */
export function groupFiles(places: Places, picked: PickedFile[], fixed: Target | null): Group[] {
  const groups = new Map<string, Group>()
  for (const f of picked) {
    const m = fixed ? { target: fixed, folder: f.dirs.slice(1) } : matchPlace(places, f.dirs, f.file.name)
    const source = f.dirs.join(' / ') || '—'
    const folder = m.folder.join('/')
    const key = `${m.target ? `${m.target.type}:${m.target.id}` : `none:${source}`}|${folder}`
    const g = groups.get(key) ?? { key, source, target: m.target, folder, files: [] }
    g.files.push(f)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => Number(!!a.target) - Number(!!b.target) || a.source.localeCompare(b.source, undefined, { numeric: true }))
}

/** Для каждого файла группы: новая версия существующего изображения или новое изображение. */
export function planGroup(g: { target: Target | null; folder: string; files: PickedFile[] }, existing: ProjectImage[], asVersions: boolean): PlannedFile[] {
  const mine = g.target ? existing.filter((i) => i.entity_type === g.target!.type && i.entity_id === g.target!.id && i.folder === g.folder) : []
  const byBase = new Map(mine.map((i) => [renderBase(i.file.name), i.id]))
  const taken = new Set<string>()
  const out: PlannedFile[] = []
  // от старой ревизии к новой: файл с тем же названием и более новой ревизией ложится версией в цепочку
  const chains = new Map<string, { item: PlannedFile; rank: number }>()
  for (const f of [...g.files].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
    const base = renderBase(f.file.name)
    const rank = f.rank ?? -1
    const chain = asVersions && base && rank >= 0 ? chains.get(base) : undefined
    if (chain && rank > chain.rank) {
      chain.item.files.push(f.file)
      chain.rank = rank
      continue
    }
    const id = asVersions && base ? byBase.get(base) : undefined
    // два файла с одним названием в папке не должны оба стать версиями одного существующего рендера
    const versionOf = id && !taken.has(id) ? id : null
    if (versionOf) taken.add(versionOf)
    const item: PlannedFile = { files: [f.file], versionOf }
    out.push(item)
    if (asVersions && base && rank >= 0) chains.set(base, { item, rank })
  }
  return out
}
