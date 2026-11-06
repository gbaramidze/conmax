// Собирает ключи tr('...') из исходников и режет на файлы-порции; уже переведённые ключи (locales/en/src.json) пропускает.
const fs = require('fs')
const path = require('path')
const ts = require('../../apps/web/node_modules/typescript')
const ROOT = __dirname + '/../../apps/web/src'
const S = __dirname + '/work/'
const N = Number(process.argv[2] || 200)
const keys = new Set()
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes('tr(')) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tr' && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) keys.add(n.arguments[0].text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
let done = {}
try { done = JSON.parse(fs.readFileSync(ROOT + '/locales/en/src.json', 'utf8')) } catch {}
const all = [...keys]
fs.writeFileSync(S + 'allkeys.json', JSON.stringify(all))
const todo = all.filter((k) => !(k in done))
fs.rmSync(S + 'chunks', { recursive: true, force: true })
fs.mkdirSync(S + 'chunks', { recursive: true })
// номера глобальные (позиция в allkeys), чтобы порции можно было переводить в любом порядке
let c = 0
for (let i = 0; i < todo.length; i += N) {
  c++
  fs.writeFileSync(S + 'chunks/k' + String(c).padStart(2, '0') + '.txt', todo.slice(i, i + N).map((s) => all.indexOf(s) + 1 + '\t' + s).join('\n'))
}
console.log('all', all.length, 'todo', todo.length, 'chunks', c)
