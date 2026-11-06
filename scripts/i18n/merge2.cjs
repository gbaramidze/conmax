// Сливает data/*.tsv (русский ключ ~~ английский ~~ грузинский) в locales/{en,ka}/src.json
const fs = require('fs')
const S = __dirname + '/work/'
const L = __dirname + '/../../apps/web/src/locales/'
const load = (lng) => JSON.parse(fs.readFileSync(L + lng + '/src.json', 'utf8'))
const en = load('en'), ka = load('ka')
const vars = (s) => (s.match(/\{\{\w+\}\}/g) || []).sort().join(',')
let n = 0, skipped = 0, bad = []
for (const f of fs.readdirSync(S + 'data').filter((x) => x.endsWith('.tsv')).sort()) {
  for (const line of fs.readFileSync(S + 'data/' + f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    const [key, e, k] = line.split('~~')
    if (k === undefined) { bad.push(f + ': ' + line.slice(0, 60)); continue }
    if (vars(e) !== vars(key) || vars(k) !== vars(key)) bad.push(f + ' vars: ' + key.slice(0, 60))
    if (key in en) { skipped++; continue }
    en[key] = e
    ka[key] = k
    n++
  }
}
fs.writeFileSync(L + 'en/src.json', JSON.stringify(en, null, 1))
fs.writeFileSync(L + 'ka/src.json', JSON.stringify(ka, null, 1))
console.log('merged', n, 'skipped(existing)', skipped, 'problems', bad.length)
bad.forEach((b) => console.log(b))
