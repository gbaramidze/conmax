// Перевод IFC (ArchiCAD, Revit) в лёгкую модель GLB для раздела «3D».
// Один и тот же код работает в браузере (Web Worker, см. ifc-worker.ts) и в node (scripts/model/ifc-to-glb.mjs),
// поэтому здесь только пакеты, без алиасов приложения.
//
// Что делает:
//  - раскладывает геометрию по этажам IFC (IfcBuildingStorey) и видам элементов (стены, плиты, окна…) и склеивает её
//    в несколько крупных кусков — так браузер рисует дом быстро;
//  - перила и прочие объекты (мебель, «объекты» ArchiCAD) упрощает: в модели отеля перила давали 64% треугольников;
//  - отбрасывает нормали (схема рисуется плоскими гранями), квантует и сжимает (meshopt), затем gzip.
// На выходе: сцена → узел на этаж (extras: gid, name, elevation — отметка из IFC в м, y — уровень пола в модели)
//         → по мешу на вид элементов (extras: category); помещения (IfcSpace, в ArchiCAD — «Зоны») — в узле «spaces»,
//         у каждого extras: gid, number, name, storey. Единицы — метры, ось Y вверх.

import * as WebIFC from 'web-ifc'
import { Document, WebIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

export type ConvertStage = 'parse' | 'geometry' | 'compress'
export interface ConvertProgress {
  stage: ConvertStage
  /** 0…1 внутри этапа */
  done: number
}
export interface ConvertedStorey {
  gid: string
  name: string
  elevation: number
  y: number
}
export interface ConvertResult {
  /** GLB, сжатый gzip */
  glbGz: Uint8Array
  /** размер GLB до gzip */
  glbSize: number
  storeys: ConvertedStorey[]
  spaces: number
  triangles: number
  elements: number
}

type Category = 'wall' | 'slab' | 'structure' | 'facade' | 'window' | 'door' | 'stair' | 'railing' | 'other' | 'space'

const CATEGORY = new Map<number, Category>([
  [WebIFC.IFCWALL, 'wall'],
  [WebIFC.IFCWALLSTANDARDCASE, 'wall'],
  [WebIFC.IFCCURTAINWALL, 'facade'],
  [WebIFC.IFCPLATE, 'facade'],
  [WebIFC.IFCMEMBER, 'facade'],
  [WebIFC.IFCSLAB, 'slab'],
  [WebIFC.IFCROOF, 'slab'],
  [WebIFC.IFCCOVERING, 'slab'],
  [WebIFC.IFCCOLUMN, 'structure'],
  [WebIFC.IFCBEAM, 'structure'],
  [WebIFC.IFCFOOTING, 'structure'],
  [WebIFC.IFCWINDOW, 'window'],
  [WebIFC.IFCDOOR, 'door'],
  [WebIFC.IFCSTAIR, 'stair'],
  [WebIFC.IFCSTAIRFLIGHT, 'stair'],
  [WebIFC.IFCRAMP, 'stair'],
  [WebIFC.IFCRAMPFLIGHT, 'stair'],
  [WebIFC.IFCRAILING, 'railing'],
])
// цвета схемы: светлые нейтральные, стекло — голубое полупрозрачное
const MATERIALS: Record<Category, [number, number, number, number]> = {
  wall: [0.93, 0.92, 0.89, 1],
  slab: [0.8, 0.8, 0.78, 1],
  structure: [0.72, 0.73, 0.75, 1],
  facade: [0.62, 0.75, 0.86, 0.45],
  window: [0.55, 0.74, 0.9, 0.4],
  door: [0.7, 0.56, 0.42, 1],
  stair: [0.75, 0.74, 0.7, 1],
  railing: [0.45, 0.47, 0.5, 1],
  other: [0.82, 0.8, 0.76, 1],
  space: [0.3, 0.55, 0.95, 0.25],
}
/**
 * Упрощение по видам — сразу для всех элементов вида на этаже (перила собраны из сотен мелких стоек и креплений,
 * по отдельности их не упростить): к какой доле треугольников стремиться и допустимое отклонение формы в метрах.
 * Перила становятся простыми панелями, мелкие объекты — грубее. Стены, плиты и окна не трогаем.
 */
const SIMPLIFY: Partial<Record<Category, { ratio: number; meters: number }>> = {
  railing: { ratio: 0.03, meters: 0.12 },
  other: { ratio: 0.2, meters: 0.06 },
}

class Grow<T extends Float32Array | Uint32Array> {
  a: T
  n = 0
  private readonly make: (n: number) => T
  constructor(make: (n: number) => T, size = 1 << 16) {
    this.make = make
    this.a = make(size)
  }
  reserve(k: number) {
    if (this.n + k <= this.a.length) return
    let len = this.a.length
    while (len < this.n + k) len *= 2
    const b = this.make(len)
    b.set(this.a.subarray(0, this.n))
    this.a = b
  }
  view(): T {
    return this.a.slice(0, this.n) as T
  }
}
const f32 = (n: number) => new Float32Array(n)
const u32 = (n: number) => new Uint32Array(n)
class Bucket {
  pos = new Grow(f32)
  idx = new Grow(u32)
  get verts() {
    return this.pos.n / 3
  }
  /** добавить элемент: координаты и индексы, отсчитанные от нуля */
  add(pos: Float32Array, idx: Uint32Array) {
    const offset = this.verts
    this.pos.reserve(pos.length)
    this.pos.a.set(pos, this.pos.n)
    this.pos.n += pos.length
    this.idx.reserve(idx.length)
    for (let i = 0; i < idx.length; i++) this.idx.a[this.idx.n++] = idx[i] + offset
  }
}

/** Убрать неиспользуемые вершины после упрощения */
function compact(pos: Float32Array, idx: Uint32Array): [Float32Array, Uint32Array] {
  const map = new Int32Array(pos.length / 3).fill(-1)
  const out = new Float32Array(Math.min(pos.length, idx.length * 3))
  let n = 0
  const ix = new Uint32Array(idx.length)
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i]
    if (map[v] < 0) {
      map[v] = n
      out[n * 3] = pos[v * 3]
      out[n * 3 + 1] = pos[v * 3 + 1]
      out[n * 3 + 2] = pos[v * 3 + 2]
      n++
    }
    ix[i] = map[v]
  }
  return [out.slice(0, n * 3), ix]
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * @param data      содержимое .ifc
 * @param init      как поднять web-ifc (в браузере — с адресом wasm, в node — по умолчанию)
 */
export async function convertIfc(
  data: Uint8Array,
  { init, onProgress, sourceName = 'model.ifc' }: { init: (api: WebIFC.IfcAPI) => Promise<void>; onProgress?: (p: ConvertProgress) => void; sourceName?: string },
): Promise<ConvertResult> {
  const progress = onProgress ?? (() => {})
  progress({ stage: 'parse', done: 0 })
  const api = new WebIFC.IfcAPI()
  await init(api)
  await MeshoptSimplifier.ready
  const model = api.OpenModel(data, { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 8, MEMORY_LIMIT: 3_500_000_000 })
  if (model < 0) throw new Error('ifc_open_failed')
  progress({ stage: 'parse', done: 1 })

  // web-ifc отдаёт значения как { value }
  const val = (v: unknown): unknown => (v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v)
  const num = (v: unknown) => Number(val(v))
  const ids = (type: number): number[] => {
    const v = api.GetLineIDsWithType(model, type)
    const out: number[] = []
    for (let i = 0; i < v.size(); i++) out.push(v.get(i))
    return out
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = (id: number): any => api.GetLine(model, id)

  // единица длины проекта — из IfcUnitAssignment (в файле бывают и другие IfcSIUnit, например метры у свойств)
  let unitScale = 1
  for (const ua of ids(WebIFC.IFCUNITASSIGNMENT)) {
    for (const uref of line(ua).Units ?? []) {
      const u = line(num(uref))
      if (u.type === WebIFC.IFCSIUNIT && val(u.UnitType) === 'LENGTHUNIT') {
        const prefix = val(u.Prefix)
        unitScale = prefix === 'MILLI' ? 0.001 : prefix === 'CENTI' ? 0.01 : prefix === 'DECI' ? 0.1 : 1
      }
    }
  }

  // этажи и принадлежность элементов
  const storeys = ids(WebIFC.IFCBUILDINGSTOREY).map((id) => {
    const s = line(id)
    return { id, gid: String(val(s.GlobalId)), name: String(val(s.Name) ?? val(s.LongName) ?? `#${id}`), elevation: (Number(val(s.Elevation)) || 0) * unitScale, y: 0 }
  })
  if (!storeys.length) throw new Error('ifc_no_storeys')
  storeys.sort((a, b) => a.elevation - b.elevation)
  const storeyById = new Map(storeys.map((s) => [s.id, s]))

  const containedIn = new Map<number, number>()
  for (const id of ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = line(id)
    const st = num(r.RelatingStructure)
    if (!storeyById.has(st)) continue
    for (const e of r.RelatedElements ?? []) containedIn.set(num(e), st)
  }
  const parentOf = new Map<number, number>()
  for (const type of [WebIFC.IFCRELAGGREGATES, WebIFC.IFCRELNESTS]) {
    for (const id of ids(type)) {
      const r = line(id)
      const whole = num(r.RelatingObject)
      for (const p of r.RelatedObjects ?? []) parentOf.set(num(p), whole)
    }
  }
  for (const [part, whole] of parentOf) if (storeyById.has(whole)) containedIn.set(part, whole)
  const voidsOf = new Map<number, number>()
  for (const id of ids(WebIFC.IFCRELVOIDSELEMENT)) {
    const r = line(id)
    voidsOf.set(num(r.RelatedOpeningElement), num(r.RelatingBuildingElement))
  }
  for (const id of ids(WebIFC.IFCRELFILLSELEMENT)) {
    const r = line(id)
    const opening = num(r.RelatingOpeningElement)
    parentOf.set(num(r.RelatedBuildingElement), voidsOf.get(opening) ?? opening)
  }
  const storeyOf = (id: number): number | null => {
    let cur: number | undefined = id
    for (let guard = 0; cur !== undefined && guard < 10; cur = parentOf.get(cur), guard++) {
      const s = containedIn.get(cur)
      if (s !== undefined) return s
    }
    return null
  }
  const categoryOf = (id: number): Category => {
    let cur: number | undefined = id
    for (let guard = 0; cur !== undefined && guard < 10; cur = parentOf.get(cur), guard++) {
      const c = CATEGORY.get(api.GetLineType(model, cur))
      if (c) return c
    }
    return 'other'
  }

  const spaceIds = new Set(ids(WebIFC.IFCSPACE))
  const spaceInfo = new Map<number, { gid: string; number: string; name: string }>()
  for (const id of spaceIds) {
    const s = line(id)
    spaceInfo.set(id, { gid: String(val(s.GlobalId)), number: String(val(s.Name) ?? '').trim(), name: String(val(s.LongName) ?? '').trim() })
  }

  // геометрия
  const buckets = new Map<string, Bucket>()
  const bucket = (key: string) => {
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = new Bucket()))
    return b
  }
  const spaceBuckets = new Map<number, Bucket>()
  const loose: { minY: number; category: Category; pos: Float32Array; idx: Uint32Array }[] = []
  const wallBottoms = new Map<number, number[]>()
  const tmpPos = new Grow(f32)
  const tmpIdx = new Grow(u32)
  let elements = 0
  let triangles = 0

  let geoDone = 0
  api.StreamAllMeshes(model, (mesh, index, total) => {
    if (index % 500 === 0 && total) {
      geoDone = Math.max(geoDone, index / total)
      progress({ stage: 'geometry', done: geoDone })
    }
    const id = mesh.expressID
    const isSpace = spaceIds.has(id)
    const category: Category = isSpace ? 'space' : categoryOf(id)
    tmpPos.n = 0
    tmpIdx.n = 0
    let minY = Infinity
    for (let g = 0; g < mesh.geometries.size(); g++) {
      const pg = mesh.geometries.get(g)
      const geom = api.GetGeometry(model, pg.geometryExpressID)
      const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
      const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
      const m = pg.flatTransformation
      const base = tmpPos.n / 3
      const count = v.length / 6
      tmpPos.reserve(count * 3)
      for (let i = 0; i < count; i++) {
        const x = v[i * 6], y = v[i * 6 + 1], z = v[i * 6 + 2]
        const Y = m[1] * x + m[5] * y + m[9] * z + m[13]
        tmpPos.a[tmpPos.n++] = m[0] * x + m[4] * y + m[8] * z + m[12]
        tmpPos.a[tmpPos.n++] = Y
        tmpPos.a[tmpPos.n++] = m[2] * x + m[6] * y + m[10] * z + m[14]
        if (Y < minY) minY = Y
      }
      tmpIdx.reserve(ix.length)
      for (let i = 0; i < ix.length; i++) tmpIdx.a[tmpIdx.n++] = ix[i] + base
      geom.delete()
    }
    if (tmpPos.n === 0 || tmpIdx.n === 0) return
    elements++
    const pos = tmpPos.a.subarray(0, tmpPos.n)
    const idx = tmpIdx.a.subarray(0, tmpIdx.n)
    if (isSpace) {
      const b = new Bucket()
      b.add(pos, idx)
      spaceBuckets.set(id, b)
      return
    }
    const st = storeyOf(id)
    if (st === null) {
      loose.push({ minY, category, pos: pos.slice(), idx: idx.slice() })
      return
    }
    bucket(`${st}|${category}`).add(pos, idx)
    if (category === 'wall') {
      const list = wallBottoms.get(st) ?? []
      list.push(minY)
      wallBottoms.set(st, list)
    }
  })
  progress({ stage: 'geometry', done: 1 })

  // сдвиг: отметка этажа в IFC + shift = уровень пола в координатах модели (медиана по низу стен)
  const diffs: number[] = []
  for (const [st, list] of wallBottoms) {
    list.sort((a, b) => a - b)
    diffs.push(list[Math.floor(list.length / 2)] - storeyById.get(st)!.elevation)
  }
  diffs.sort((a, b) => a - b)
  const shift = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0
  for (const s of storeys) s.y = s.elevation + shift
  // элементы без этажа — на этаж, в пределах которого их низ
  for (const l of loose) {
    let st = storeys[0]
    for (const s of storeys) if (l.minY >= s.y - 0.05) st = s
    bucket(`${st.id}|${l.category}`).add(l.pos, l.idx)
  }
  // упрощение по видам на этаже: «небрежное» (сливает вершины по сетке), поэтому справляется с россыпью мелких деталей
  for (const [key, b] of buckets) {
    const simp = SIMPLIFY[key.split("|")[1] as Category]
    if (!simp || b.idx.n < 3000) continue
    const pos = b.pos.view()
    const scale = MeshoptSimplifier.getScale(pos, 3)
    if (!(scale > 0)) continue
    const target = Math.max(36, Math.floor((b.idx.n * simp.ratio) / 3) * 3)
    const [simplified] = MeshoptSimplifier.simplifySloppy(b.idx.view(), pos, 3, null, target, simp.meters / scale)
    if (simplified.length === 0) continue
    const [p, i] = compact(pos, simplified)
    const nb = new Bucket()
    nb.add(p, i)
    buckets.set(key, nb)
  }
  for (const b of [...buckets.values(), ...spaceBuckets.values()]) triangles += b.idx.n / 3
  const storeyOfSpace = new Map([...spaceBuckets.keys()].map((id) => [id, storeyOf(id)]))
  api.CloseModel(model)

  // центрируем по горизонтали: у ArchiCAD координаты бывают от точки съёмки, далеко от нуля
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const b of [...buckets.values(), ...spaceBuckets.values()]) {
    const a = b.pos.a
    for (let i = 0; i < b.pos.n; i += 3) {
      if (a[i] < minX) minX = a[i]
      if (a[i] > maxX) maxX = a[i]
      if (a[i + 2] < minZ) minZ = a[i + 2]
      if (a[i + 2] > maxZ) maxZ = a[i + 2]
    }
  }
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2

  // сборка glTF
  progress({ stage: 'compress', done: 0 })
  const doc = new Document()
  const buffer = doc.createBuffer()
  const scene = doc.createScene('building')
  const materials = Object.fromEntries(
    (Object.keys(MATERIALS) as Category[]).map((name) => {
      const c = MATERIALS[name]
      return [name, doc.createMaterial(name).setBaseColorFactor(c).setAlphaMode(c[3] < 1 ? 'BLEND' : 'OPAQUE').setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1)]
    }),
  ) as Record<Category, ReturnType<Document['createMaterial']>>
  const primitive = (b: Bucket, material: ReturnType<Document['createMaterial']>) => {
    const pos = b.pos.view()
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= cx
      pos[i + 2] -= cz
    }
    return doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(b.idx.view()).setBuffer(buffer))
      .setMaterial(material)
  }

  const r3 = (n: number) => Math.round(n * 1000) / 1000
  const storeyList: ConvertedStorey[] = []
  for (const s of storeys) {
    const node = doc.createNode(s.name).setExtras({ gid: s.gid, name: s.name, elevation: r3(s.elevation), y: r3(s.y) })
    for (const cat of Object.keys(MATERIALS) as Category[]) {
      const b = buckets.get(`${s.id}|${cat}`)
      if (!b || b.idx.n === 0) continue
      node.addChild(doc.createNode(cat).setExtras({ category: cat }).setMesh(doc.createMesh(cat).addPrimitive(primitive(b, materials[cat]))))
    }
    scene.addChild(node)
    storeyList.push({ gid: s.gid, name: s.name, elevation: r3(s.elevation), y: r3(s.y) })
  }
  const spaceList: { gid: string; number: string; name: string; storey: string | null }[] = []
  if (spaceBuckets.size) {
    const group = doc.createNode('spaces')
    for (const [id, b] of spaceBuckets) {
      const info = spaceInfo.get(id)!
      const st = storeyById.get(storeyOfSpace.get(id) ?? -1)
      const entry = { gid: info.gid, number: info.number, name: info.name, storey: st?.gid ?? null }
      group.addChild(doc.createNode(`space ${info.number}`).setExtras(entry).setMesh(doc.createMesh('space').addPrimitive(primitive(b, materials.space))))
      spaceList.push(entry)
    }
    scene.addChild(group)
  }
  const extras = { buildos: 1, source: sourceName, storeys: storeyList, spaces: spaceList, size: { x: r3(maxX - minX), z: r3(maxZ - minZ) } }
  doc.getRoot().setExtras(extras)
  scene.setExtras(extras)

  await MeshoptEncoder.ready
  doc.createExtension(KHRMeshQuantization).setRequired(true)
  await doc.transform(dedup(), prune(), weld(), quantize({ quantizePosition: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  progress({ stage: 'compress', done: 0.7 })
  const io = new WebIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  const glb = await io.writeBinary(doc)
  const glbGz = await gzip(glb)
  progress({ stage: 'compress', done: 1 })
  return { glbGz, glbSize: glb.byteLength, storeys: storeyList, spaces: spaceList.length, triangles, elements }
}
