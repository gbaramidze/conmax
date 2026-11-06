// Сливает tsv/*.tsv (индекс \t английский \t грузинский) в locales/{en,ka}/src.json; проверяет подстановки {{...}}.
const fs = require('fs')
const S = __dirname + '/work/'
const L = __dirname + '/../../apps/web/src/locales/'
const all = JSON.parse(fs.readFileSync(S + 'allkeys.json', 'utf8'))
const load = (lng) => { try { return JSON.parse(fs.readFileSync(L + lng + '/src.json', 'utf8')) } catch { return {} } }
const en = load('en'), ka = load('ka')
const vars = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join(',')
let n = 0, bad = []
for (const f of fs.readdirSync(S + 'tsv').filter((x) => x.endsWith('.tsv')).sort()) {
  for (const line of fs.readFileSync(S + 'tsv/' + f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    let [i, e, k] = line.split('~~')
    if (e !== undefined) e = e.replace(/\\n/g, '\n')
    if (k !== undefined) k = k.replace(/\\n/g, '\n')
    const key = all[Number(i) - 1]
    if (key === undefined || e === undefined || k === undefined) { bad.push(f + ': ' + line.slice(0, 60)); continue }
    const lead = key.match(/^\s*/)[0], trail = key.match(/\s*$/)[0]
    const fix = (t) => lead + t.trim() + trail
    if (vars(e) !== vars(key) || vars(k) !== vars(key)) bad.push(f + ' #' + i + ' vars: ' + key.slice(0, 50))
    en[key] = fix(e)
    ka[key] = fix(k)
    n++
  }
}
fs.mkdirSync(L + 'en', { recursive: true })
fs.writeFileSync(L + 'en/src.json', JSON.stringify(en, null, 1))
fs.writeFileSync(L + 'ka/src.json', JSON.stringify(ka, null, 1))
console.log('merged', n, 'total en', Object.keys(en).length, 'of', all.length, 'problems', bad.length)
bad.slice(0, 40).forEach((b) => console.log(b))
