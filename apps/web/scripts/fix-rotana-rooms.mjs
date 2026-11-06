// Доводит номера Rotana до таблицы «Apartments (2)»: количество номеров каждого типа на каждом этаже (всего 537).
// Этажи 3–19: уточняет типы по списку номеров; этажи 20–27: создаёт номера и типы по шаблону вышележащего этажа.
// Запуск: node scripts/fix-rotana-rooms.mjs <Excel> [--dry]   (RT_EMAIL, RT_PASSWORD — пользователь с правами руководителя проекта)
import { createClient } from '@supabase/supabase-js'
import readXlsxFile from 'read-excel-file/node'
import { readFileSync } from 'node:fs'

const [, , excelPath, ...flags] = process.argv
const DRY = flags.includes('--dry')
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.VITE_SUPABASE_URL.startsWith('/') ? 'http://127.0.0.1:54321' : env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
const rpc = async (name, args) => {
  const { data, error } = await sb.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
const normType = (t) => String(t).trim().replace(/^ONE BEDROOM 3$/, 'JUNIOR SUITE 3')

// ---- целевое количество: floor → type → n
const sheets = await readXlsxFile(excelPath, { getSheets: true })
const apt = sheets.find((s) => s.sheet === 'Apartments (2)').data
const floorCols = apt[1].map((v, i) => [String(v ?? ''), i]).filter(([v]) => /^L\d+$/.test(v))
const want = new Map()
for (const row of apt.slice(3)) {
  const type = normType(row[0] ?? '')
  if (!type || /^(\d+)?$/.test(type)) continue
  for (const [label, col] of floorCols) {
    const n = Number(row[col] ?? 0)
    if (n > 0) {
      const fl = +label.slice(1)
      if (!want.has(fl)) want.set(fl, new Map())
      want.get(fl).set(type, n)
    }
  }
}
const total = [...want.values()].reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0)
console.log(`Таблица Apartments (2): этажей ${want.size}, номеров ${total}`)
if (total !== 537) throw new Error('Ожидалось 537 номеров, в таблице ' + total)
if (DRY) process.exit(0)

const { error: authError } = await sb.auth.signInWithPassword({ email: process.env.RT_EMAIL, password: process.env.RT_PASSWORD })
if (authError) throw authError
const { data: project } = await sb.from('projects').select('id').eq('code', 'RTG1').single()
const P = project.id

const { data: types } = await sb.from('room_types').select('id, name').eq('project_id', P).is('deleted_at', null)
const typeId = new Map(types.map((t) => [t.name, t.id]))
for (const t of new Set([...want.values()].flatMap((m) => [...m.keys()]))) if (!typeId.has(t)) throw new Error('Нет типа номера ' + t)

const { data: floors } = await sb.from('locations').select('id, path, sort').eq('project_id', P).eq('kind', 'floor').is('deleted_at', null).limit(5000)
const floorByNo = new Map(floors.map((f) => [f.sort, f]))
const { data: rooms } = await sb.from('locations').select('id, path, parent_id').eq('project_id', P).eq('kind', 'room').is('deleted_at', null).limit(10000)
const { data: specs } = await sb.from('room_specs').select('location_id, type_id').eq('project_id', P).limit(10000)
const typeNameById = new Map(types.map((t) => [t.id, t.name]))
const curType = new Map(specs.map((s) => [s.location_id, typeNameById.get(s.type_id) ?? null]))

// комнаты этажа по номеру позиции (301 → 1)
const roomsOf = (floorNo) => {
  const f = floorByNo.get(floorNo)
  return rooms
    .filter((r) => r.parent_id === f.id)
    .map((r) => ({ ...r, pos: Number(/R(\d+)$/.exec(r.path)[1]) % 100 }))
    .sort((a, b) => a.pos - b.pos)
}

const changes = new Map() // roomId → тип
const PREFER = [2, 3, 19, 21]
const countOf = (list) => list.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map())

// 1. Этажи 3–19: подправить типы под таблицу
for (let fl = 3; fl <= 19; fl++) {
  const list = roomsOf(fl)
  const have = countOf(list.map((r) => curType.get(r.id)))
  const target = want.get(fl)
  const surplus = []
  const deficit = []
  for (const t of new Set([...have.keys(), ...target.keys()])) {
    const d = (have.get(t) ?? 0) - (target.get(t) ?? 0)
    for (let i = 0; i < Math.abs(d); i++) (d > 0 ? surplus : deficit).push(t)
  }
  for (const need of deficit) {
    // номер, который отдаём под нужный тип: предпочтительные позиции, затем по порядку; тип — из лишних
    const candidates = list
      .filter((r) => !changes.has(r.id) && surplus.includes(curType.get(r.id)))
      .sort((a, b) => (PREFER.includes(a.pos) ? PREFER.indexOf(a.pos) : 99 + a.pos) - (PREFER.includes(b.pos) ? PREFER.indexOf(b.pos) : 99 + b.pos))
    const pick = candidates[0]
    if (!pick) throw new Error(`Этаж ${fl}: не нашёл номер для типа ${need}`)
    surplus.splice(surplus.indexOf(curType.get(pick.id)), 1)
    changes.set(pick.id, need)
  }
}

// 2. Этажи 20–27: новые номера
const template = roomsOf(19).map((r) => ({ pos: r.pos, type: changes.get(r.id) ?? curType.get(r.id) }))
const newRooms = []
for (let fl = 20; fl <= 27; fl++) {
  const target = new Map(want.get(fl))
  const f = floorByNo.get(fl)
  if (!f) throw new Error('Нет этажа ' + fl)
  const assigned = []
  if ([...target.values()].reduce((a, b) => a + b, 0) === 22) {
    // как этаж 19: тот же шаблон по позициям
    for (const t of template) assigned.push(t.type)
  } else {
    for (const t of template) {
      if ((target.get(t.type) ?? 0) > 0) {
        assigned.push(t.type)
        target.set(t.type, target.get(t.type) - 1)
      }
    }
    for (const [t, n] of target) for (let i = 0; i < n; i++) assigned.push(t)
  }
  assigned.forEach((type, i) => newRooms.push({ floor: fl, parent: f.id, number: fl * 100 + i + 1, type }))
}

console.log(`Сменить тип у номеров: ${changes.size}; создать номеров на этажах 20–27: ${newRooms.length}`)
const existingPaths = new Set(rooms.map((r) => r.path))
const toInsert = newRooms
  .filter((r) => !existingPaths.has(`H.F${r.floor}.R${r.number}`))
  .map((r) => ({ project_id: P, parent_id: r.parent, kind: 'room', code: `R${r.number}`, name: `Номер ${r.number}`, sort: r.number % 100 }))
for (let i = 0; i < toInsert.length; i += 200) {
  const { error } = await sb.from('locations').insert(toInsert.slice(i, i + 200))
  if (error) throw new Error('номера: ' + error.message)
}
const { data: after } = await sb.from('locations').select('id, path').eq('project_id', P).eq('kind', 'room').is('deleted_at', null).limit(10000)
const idByPath = new Map(after.map((r) => [r.path, r.id]))
const newIds = newRooms.map((r) => idByPath.get(`H.F${r.floor}.R${r.number}`)).filter(Boolean)
if (newIds.length) await rpc('set_location_purpose', { p_project: P, p_ids: newIds, p_purpose: 'hotel_room' })

const byType = new Map()
for (const r of newRooms) {
  const id = idByPath.get(`H.F${r.floor}.R${r.number}`)
  if (id) byType.set(r.type, [...(byType.get(r.type) ?? []), id])
}
for (const [id, t] of changes) byType.set(t, [...(byType.get(t) ?? []), id])
let applied = 0
for (const [t, ids] of byType) applied += await rpc('apply_room_type', { p_project: P, p_locations: ids, p_type: typeId.get(t) })
console.log(`Типов назначено: ${applied}`)

// 3. Проверка
const { data: specs2 } = await sb.from('room_specs').select('location_id, type_id').eq('project_id', P).limit(10000)
const typeOf = new Map(specs2.map((s) => [s.location_id, typeNameById.get(s.type_id)]))
const problems = []
let roomsTotal = 0
for (let fl = 3; fl <= 27; fl++) {
  const list = roomsOf2(fl)
  roomsTotal += list.length
  const have = countOf(list.map((r) => typeOf.get(r.id)))
  for (const [t, n] of want.get(fl)) if ((have.get(t) ?? 0) !== n) problems.push(`L${fl} ${t}: надо ${n}, в базе ${have.get(t) ?? 0}`)
  for (const [t, n] of have) if (!want.get(fl).has(t)) problems.push(`L${fl} ${t}: лишних ${n}`)
}
function roomsOf2(fl) {
  const f = floorByNo.get(fl)
  return after.filter((r) => r.path.startsWith(f.path + '.')).map((r) => ({ id: r.id }))
}
console.log(`Номеров на этажах 3–27: ${roomsTotal}`)
console.log(problems.length ? 'Расхождения:\n  ' + problems.join('\n  ') : 'Количество номеров каждого типа на каждом этаже совпадает с таблицей Apartments (2)')
