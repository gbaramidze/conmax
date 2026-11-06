// Разовый импорт для проекта Rotana (RTG1): чертежи мебели (PDF), каталог позиций, типы номеров, помещения и их типы.
// Запуск: node scripts/import-rotana-ffe.mjs <Excel> <папка с PDF> [--dry]
// Вход: переменные RT_EMAIL и RT_PASSWORD (пользователь с правами руководителя проекта).
import { createClient } from '@supabase/supabase-js'
import readXlsxFile from 'read-excel-file/node'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const [, , excelPath, pdfDir, ...flags] = process.argv
const DRY = flags.includes('--dry')
const PROJECT_CODE = process.env.RT_PROJECT ?? 'RTG1'
const FIRST_TYPED_FLOOR = 3
const LAST_TYPED_FLOOR = 19

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.VITE_SUPABASE_URL.startsWith('/') ? 'http://127.0.0.1:54321' : env.VITE_SUPABASE_URL
const sb = createClient(url, env.VITE_SUPABASE_PUBLISHABLE_KEY)

const log = (...a) => console.log(...a)
const rpc = async (name, args) => {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

// ---------------------------------------------------------------------------
// Разбор Excel
// ---------------------------------------------------------------------------
const sheets = await readXlsxFile(excelPath, { getSheets: true })
const sheet = (n) => sheets.find((s) => s.sheet === n)?.data ?? []
const furn = sheet('Furniture')
const typeNames = furn[1].slice(2, 20).filter(Boolean).map(String)
const typeColumns = furn[1].map((v, i) => [String(v ?? ''), i]).filter(([v]) => typeNames.includes(v))

const items = new Map()
for (const row of furn.slice(3)) {
  const id = String(row[0] ?? '').trim()
  const code = String(row[1] ?? '').trim()
  if (!code || !/^CM-/.test(code)) continue
  const it = items.get(code) ?? { code, ids: [], qty: new Map() }
  if (id && !it.ids.includes(id)) it.ids.push(id)
  for (const [name, col] of typeColumns) {
    const q = Number(row[col])
    if (q > 0) it.qty.set(name, (it.qty.get(name) ?? 0) + q)
  }
  items.set(code, it)
}

// номера: 301 → этаж 3; тип из списка («KING 2» = «STANDARD KING 2»)
const roomType = (t) => (/^(KING|TWIN) \d$/.test(t) ? `STANDARD ${t}` : t)
const rooms = []
for (const row of sheet('Sheet1')) {
  const n = row[0]
  if (typeof n !== 'number' || !row[1]) continue
  const floor = Math.floor(n / 100)
  if (floor < FIRST_TYPED_FLOOR || floor > LAST_TYPED_FLOOR) continue
  rooms.push({ number: n, floor, type: roomType(String(row[1]).trim()) })
}
const unknownTypes = [...new Set(rooms.map((r) => r.type))].filter((t) => !typeNames.includes(t))
if (unknownTypes.length) throw new Error('Типы номеров, которых нет в таблице мебели: ' + unknownTypes.join(', '))

// PDF: ID-701_… → документ с шифром ID-701
const files = readdirSync(pdfDir).filter((f) => /\.pdf$/i.test(f)).sort()
const fileId = (f) => /^(ID-\d+)/i.exec(f)?.[1].toUpperCase()

log(`Таблица: позиций ${items.size}, типов номеров ${typeNames.length}, номеров с типом (этажи ${FIRST_TYPED_FLOOR}–${LAST_TYPED_FLOOR}) ${rooms.length}`)
log(`PDF: ${files.length}; позиций без чертежа в папке: ${[...items.values()].filter((i) => !i.ids.some((id) => files.some((f) => fileId(f) === id))).length}`)
if (DRY) process.exit(0)

// ---------------------------------------------------------------------------
// Вход и проект
// ---------------------------------------------------------------------------
const { error: authError } = await sb.auth.signInWithPassword({ email: process.env.RT_EMAIL, password: process.env.RT_PASSWORD })
if (authError) throw authError
const { data: project } = await sb.from('projects').select('id, tenant_id').eq('code', PROJECT_CODE).single()
const P = project.id
const T = project.tenant_id

// ---------------------------------------------------------------------------
// 1. Документы
// ---------------------------------------------------------------------------
const { data: existingDocs } = await sb.from('documents').select('id, code, title').eq('project_id', P).is('deleted_at', null).limit(5000)
const docByTitle = new Map(existingDocs.map((d) => [d.title.trim().toLowerCase(), d]))
const docById = new Map() // ID-701 → id документа
for (const d of existingDocs) {
  const m = /^(ID-\d+)/i.exec(d.code ?? d.title)
  if (m) docById.set(m[1].toUpperCase(), d.id)
}

let folderId = null
{
  const { data: folders } = await sb.from('document_folders').select('id, name').eq('project_id', P)
  folderId = folders?.find((f) => f.name === 'Чертежи мебели (FF&E)')?.id ?? (await rpc('create_folder', { p_project: P, p_parent: null, p_name: 'Чертежи мебели (FF&E)' }))
}

let uploaded = 0
let reused = 0
const newDocs = []
for (const f of files) {
  const title = f.replace(/\.pdf$/i, '').trim()
  const id = fileId(f)
  const existing = docByTitle.get(title.toLowerCase())
  if (existing) {
    reused++
    if (id) docById.set(id, existing.id)
    continue
  }
  const bytes = readFileSync(path.join(pdfDir, f))
  const key = `${T}/${P}/${randomUUID()}.pdf`
  const up = await sb.storage.from('files').upload(key, bytes, { contentType: 'application/pdf' })
  if (up.error) throw new Error(`${f}: ${up.error.message}`)
  const { data: fileRow, error: fe } = await sb.from('files').insert({ project_id: P, storage_key: key, name: f, mime: 'application/pdf', size_bytes: statSync(path.join(pdfDir, f)).size }).select('id').single()
  if (fe) throw new Error(`${f}: ${fe.message}`)
  let docId
  try {
    docId = await rpc('create_document', { p_project: P, p_title: title, p_code: id ?? null, p_doc_type: 'drawing', p_discipline: null, p_visibility: 'internal', p_requires_ack: false, p_file: fileRow.id, p_revision: '', p_note: '', p_locations: [], p_orgs: [], p_publish: true })
  } catch (e) {
    if (!/code_taken/.test(e.message)) throw e
    docId = await rpc('create_document', { p_project: P, p_title: title, p_code: null, p_doc_type: 'drawing', p_discipline: null, p_visibility: 'internal', p_requires_ack: false, p_file: fileRow.id, p_revision: '', p_note: '', p_locations: [], p_orgs: [], p_publish: true })
  }
  if (id) docById.set(id, docId)
  newDocs.push(docId)
  uploaded++
  if (uploaded % 10 === 0) log(`  загружено чертежей: ${uploaded}`)
}
if (newDocs.length) await rpc('move_documents', { p_documents: newDocs, p_folder: folderId })
log(`Чертежи: загружено ${uploaded}, уже были в проекте ${reused}`)

// ---------------------------------------------------------------------------
// 2. Каталог позиций и привязка чертежей
// ---------------------------------------------------------------------------
const { data: existingItems } = await sb.from('ffe_items').select('id, code').eq('project_id', P).is('deleted_at', null).limit(5000)
const itemIdByCode = new Map(existingItems.map((i) => [i.code.toLowerCase(), i.id]))
let itemsCreated = 0
for (const it of items.values()) {
  if (!itemIdByCode.has(it.code.toLowerCase())) {
    const id = await rpc('ffe_upsert_item', { p_project: P, p_id: null, p_code: it.code, p_name: it.code, p_category: it.code.split('-').slice(0, 2).join('-'), p_unit: 'шт', p_note: it.ids.length ? `Чертёж: ${it.ids.join(', ')}` : null })
    itemIdByCode.set(it.code.toLowerCase(), id)
    itemsCreated++
  }
}
const { data: existingLinks } = await sb.from('document_links').select('document_id, entity_id').eq('project_id', P).eq('entity_type', 'ffe_item').limit(10000)
const linked = new Set(existingLinks.map((l) => `${l.document_id}:${l.entity_id}`))
let links = 0
for (const it of items.values()) {
  const itemId = itemIdByCode.get(it.code.toLowerCase())
  for (const id of it.ids) {
    const docId = docById.get(id)
    if (!docId || linked.has(`${docId}:${itemId}`)) continue
    const { error } = await sb.from('document_links').insert({ document_id: docId, entity_type: 'ffe_item', entity_id: itemId })
    if (error) throw new Error(`${it.code}/${id}: ${error.message}`)
    links++
  }
}
log(`Каталог: создано позиций ${itemsCreated}, привязано чертежей ${links}`)

// ---------------------------------------------------------------------------
// 3. Типы номеров и их состав
// ---------------------------------------------------------------------------
const { data: existingTypes } = await sb.from('room_types').select('id, name').eq('project_id', P).is('deleted_at', null)
const typeId = new Map(existingTypes.map((t) => [t.name, t.id]))
for (const name of [...typeNames, 'PRESIDENTIAL']) {
  if (!typeId.has(name)) typeId.set(name, await rpc('room_type_upsert', { p_project: P, p_id: null, p_name: name, p_area: null, p_specs: null }))
}
const { data: typeItems } = await sb.from('room_type_items').select('type_id, item_id').eq('project_id', P).limit(10000)
const haveTypeItem = new Set(typeItems.map((x) => `${x.type_id}:${x.item_id}`))
let typeLines = 0
for (const it of items.values()) {
  const itemId = itemIdByCode.get(it.code.toLowerCase())
  for (const [name, qty] of it.qty) {
    const tid = typeId.get(name)
    if (haveTypeItem.has(`${tid}:${itemId}`)) continue
    await rpc('room_type_set_item', { p_project: P, p_type: tid, p_item: itemId, p_qty: qty })
    typeLines++
  }
}
log(`Типы номеров: ${typeId.size}, строк состава добавлено ${typeLines}`)

// ---------------------------------------------------------------------------
// 4. Номера и назначение типов
// ---------------------------------------------------------------------------
const { data: floors } = await sb.from('locations').select('id, path').eq('project_id', P).eq('kind', 'floor').is('deleted_at', null).limit(5000)
const floorId = new Map(floors.map((f) => [f.path, f.id]))
const { data: existingRooms } = await sb.from('locations').select('id, path').eq('project_id', P).eq('kind', 'room').is('deleted_at', null).limit(10000)
const roomIdByPath = new Map(existingRooms.map((r) => [r.path, r.id]))
const floorPath = (n) => `H.F${String(n).padStart(2, '0')}`
const toCreate = []
rooms.forEach((r, i) => {
  const fp = floorPath(r.floor)
  if (!floorId.has(fp)) throw new Error(`Нет этажа ${fp} в структуре проекта`)
  if (!roomIdByPath.has(`${fp}.R${r.number}`)) toCreate.push({ project_id: P, parent_id: floorId.get(fp), kind: 'room', code: `R${r.number}`, name: `Номер ${r.number}`, sort: r.number % 100 })
})
for (let i = 0; i < toCreate.length; i += 200) {
  const { error } = await sb.from('locations').insert(toCreate.slice(i, i + 200))
  if (error) throw new Error('номера: ' + error.message)
}
const { data: allRooms } = await sb.from('locations').select('id, path').eq('project_id', P).eq('kind', 'room').is('deleted_at', null).limit(10000)
const idByPath = new Map(allRooms.map((r) => [r.path, r.id]))
const byType = new Map()
const roomIds = []
for (const r of rooms) {
  const id = idByPath.get(`${floorPath(r.floor)}.R${r.number}`)
  if (!id) continue
  roomIds.push(id)
  byType.set(r.type, [...(byType.get(r.type) ?? []), id])
}
if (roomIds.length) await rpc('set_location_purpose', { p_project: P, p_ids: roomIds, p_purpose: 'hotel_room' })
let applied = 0
for (const [type, ids] of byType) applied += await rpc('apply_room_type', { p_project: P, p_locations: ids, p_type: typeId.get(type) })
log(`Номера: создано ${toCreate.length}, типов назначено ${applied}`)

// ---------------------------------------------------------------------------
// 5. Проверка по листу Apartments (количество номеров каждого типа на этаже)
// ---------------------------------------------------------------------------
const apt = sheet('Apartments')
const aptTypes = apt[1].slice(1, 20).map((v) => roomType(String(v)).replace('ONE BEDROOM 3', 'JUNIOR SUITE 3'))
const problems = []
for (const row of apt.slice(2)) {
  const m = /^L(\d+)$/.exec(String(row[0] ?? ''))
  if (!m || +m[1] < FIRST_TYPED_FLOOR || +m[1] > LAST_TYPED_FLOOR) continue
  aptTypes.forEach((t, i) => {
    const expected = Number(row[i + 1] ?? 0)
    const got = rooms.filter((r) => r.floor === +m[1] && r.type === t).length
    if (expected !== got) problems.push(`L${m[1]} ${t}: в таблице типов ${expected}, в списке номеров ${got}`)
  })
}
log(problems.length ? `Расхождения листа Apartments и списка номеров (${problems.length}):\n  ` + problems.join('\n  ') : 'Проверка по листу Apartments: количество номеров каждого типа на этажах 3–19 сходится')
