// Словари для серверных текстов (письма и push на языке получателя): supabase/functions/_shared/dict-<язык>.json.
// Edge-функции не видят папку приложения, поэтому нужные ключи копируются из apps/web/src/locales/<язык>/src.json:
//  - шаблоны с {{p1}}… (тексты уведомлений из базы);
//  - ключи, совпадающие с русскими строками в SQL (миграции, seed.sql): названия статусов, ролей, категорий и т.п.
// Запускать после изменения словарей: node scripts/i18n/server-dict.cjs
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const sqlFiles = [
  ...fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => path.join(root, 'supabase', 'migrations', f)),
  path.join(root, 'supabase', 'seed.sql'),
].filter((f) => fs.existsSync(f))

const literals = new Set()
for (const f of sqlFiles) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(/'((?:[^']|'')*)'/g)) {
    const s = m[1].replace(/''/g, "'")
    if (/[А-Яа-яЁё]/.test(s) && s.length <= 300) literals.add(s)
  }
}

for (const lang of ['ka', 'en']) {
  const src = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'web', 'src', 'locales', lang, 'src.json'), 'utf8'))
  const out = {}
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string' || v === '') continue
    if (/\{\{p\d+\}\}/.test(k) || literals.has(k)) out[k] = v
  }
  const target = path.join(root, 'supabase', 'functions', '_shared', `dict-${lang}.json`)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n', 'utf8')
  console.log(`${lang}: ${Object.keys(out).length} ключей → ${path.relative(root, target)}`)
}
