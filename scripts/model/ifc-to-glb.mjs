// Перевод IFC в лёгкую модель для раздела «3D» проекта — из командной строки.
//
//   node scripts/model/ifc-to-glb.mjs "модель.ifc|.ifczip" [выход.glb.gz]
//
// Сам перевод — apps/web/src/features/model/ifc-convert.ts (тот же код работает в браузере при загрузке IFC на странице «3D»).
// На выходе .glb.gz (GLB, сжатый gzip) — его можно загрузить на странице «3D» через «Загрузить новую версию».
// Нужен Node 23.6+ (умеет запускать TypeScript без сборки); зависимости — из apps/web (pnpm install в корне).

import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import JSZip from '../../apps/web/node_modules/jszip/lib/index.js'
import { convertIfc } from '../../apps/web/src/features/model/ifc-convert.ts'

const input = process.argv[2]
if (!input) {
  console.error('Укажите файл: node scripts/model/ifc-to-glb.mjs model.ifc [out.glb.gz]')
  process.exit(1)
}
const output = process.argv[3] ?? input.replace(/\.ifc(zip)?$/i, '') + '.glb.gz'
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} с]`, ...a)

log(`Читаем ${basename(input)} (${(statSync(input).size / 1048576).toFixed(0)} МБ)…`)
let data = new Uint8Array(readFileSync(input))
if (/\.ifczip$/i.test(input) || (data[0] === 0x50 && data[1] === 0x4b)) {
  const zip = await JSZip.loadAsync(data)
  const entry = Object.values(zip.files).find((f) => !f.dir && /\.ifc$/i.test(f.name))
  if (!entry) throw new Error('В архиве нет файла .ifc')
  data = await entry.async('uint8array')
  log(`Распакован ${entry.name} (${(data.byteLength / 1048576).toFixed(0)} МБ)`)
}

let last = ''
const result = await convertIfc(data, {
  sourceName: basename(input),
  init: (api) => api.Init(),
  onProgress: ({ stage, done }) => {
    const s = `${stage} ${Math.round(done * 10) * 10}%`
    if (s !== last) log(s)
    last = s
  },
})
writeFileSync(output, result.glbGz)
log(
  `Готово: ${output} — ${(result.glbGz.byteLength / 1048576).toFixed(1)} МБ (GLB ${(result.glbSize / 1048576).toFixed(1)} МБ), ` +
    `этажей ${result.storeys.length}, помещений ${result.spaces}, элементов ${result.elements}, треугольников ${(result.triangles / 1e6).toFixed(2)} млн`,
)
