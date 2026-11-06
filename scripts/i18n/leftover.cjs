const fs = require('fs')
const path = require('path')
const ts = require('../../apps/web/node_modules/typescript')
const ROOT = __dirname + '/../../apps/web/src'
const CYR = /[А-Яа-яЁё]/
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const res = []
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (['lib/i18n.ts', 'lib/database.types.ts'].includes(rel)) continue
  const src = fs.readFileSync(file, 'utf8')
  if (!CYR.test(src)) continue
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const inTr = (n) => { for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'tr') return true; return false }
  const visit = (n) => {
    const kinds = [ts.isStringLiteral(n), ts.isNoSubstitutionTemplateLiteral(n), ts.isTemplateHead(n), ts.isTemplateMiddle(n), ts.isTemplateTail(n), ts.isJsxText(n)]
    if (kinds.some(Boolean)) {
      const text = n.text ?? n.getText(sf)
      if (CYR.test(text) && !inTr(n) && !ts.isImportDeclaration(n.parent)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
        res.push(rel + ':' + line + '  ' + text.replace(/\s+/g, ' ').trim().slice(0, 90))
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
console.log(res.length)
console.log(res.join('\n'))
