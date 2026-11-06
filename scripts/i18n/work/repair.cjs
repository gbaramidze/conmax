// Разовое восстановление: повторный разбор старого v01.tsv записал переводы не на те ключи. Берём правильные значения из копии.
const fs = require('fs')
const L = 'C:/dev/buildos/apps/web/src/locales/'
const B = 'C:/dev/backups/src-after-tr1/locales/'
const rules = [['ამოცანების', 'დავალებების'], ['ამოცანებ', 'დავალებებ'], ['ამოცანის', 'დავალების'], ['ამოცანიდან', 'დავალებიდან'], ['ამოცანა', 'დავალება'], ['ამოც.', 'დავ.']]
const fixKa = (s) => rules.reduce((t, [a, b]) => t.split(a).join(b), s)
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const en = load(L + 'en/src.json'), ka = load(L + 'ka/src.json')
const benEn = load(B + 'en/src.json'), benKa = load(B + 'ka/src.json')
const intentional = new Set(['Сроки'])
let fixed = 0
for (const key of Object.keys(benEn)) {
  if (intentional.has(key)) continue
  if (en[key] !== benEn[key]) {
    console.log('restore:', key.slice(0, 60), '|', String(en[key]).slice(0, 40), '->', benEn[key].slice(0, 40))
    en[key] = benEn[key]
    ka[key] = fixKa(benKa[key])
    fixed++
  }
}
fs.writeFileSync(L + 'en/src.json', JSON.stringify(en, null, 1))
fs.writeFileSync(L + 'ka/src.json', JSON.stringify(ka, null, 1))
console.log('restored', fixed)
