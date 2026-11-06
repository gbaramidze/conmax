// Оборачивает русские строки в tr('...') по AST. Запуск: node codemod.cjs [--apply]
const fs = require('fs')
const path = require('path')
const ts = require('../../apps/web/node_modules/typescript')

const ROOT = __dirname + '/../../apps/web/src'
const APPLY = process.argv.includes('--apply')
const CYR = /[А-Яа-яЁё]/
const SKIP_FILES = ['lib/i18n.ts', 'lib/tr.ts', 'lib/database.types.ts']
const SKIP_CALLEES = new Set(['eq', 'neq', 'in', 'ilike', 'like', 'insert', 'update', 'upsert', 'rpc', 'from', 'select', 'order', 'filter', 'match', 'or', 'not', 'is', 'contains', 'includes', 'startsWith', 'endsWith', 'indexOf', 'localeCompare', 'split', 'replace', 'replaceAll', 'match', 'matchAll', 'RegExp', 'getItem', 'setItem', 'ensureQueryData', 'invalidateQueries', 'setQueryData', 'getQueryData', 'querySelector', 'querySelectorAll', 'closest', 'add', 'has', 'get', 'set', 'delete'])
const RESERVED = new Set(['count', 'context', 'defaultValue', 'ns', 'lng', 'replace', 'ordinal', 'returnObjects', 'joinArrays', 'postProcess', 'interpolation', 'skipInterpolation', 'keySeparator', 'nsSeparator'])

const stats = { files: 0, strings: 0, jsx: 0, attrs: 0, templates: 0, skippedTemplates: [], skippedRuns: [] }
const keys = new Set()

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

function q(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '') + "'"
}

function cleanJsx(text) {
  const lines = text.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  lines.forEach((l, i) => { if (/[^ \t]/.test(l)) lastNonEmpty = i })
  let str = ''
  lines.forEach((line, i) => {
    let t = line.replace(/\t/g, ' ')
    if (i !== 0) t = t.replace(/^[ ]+/, '')
    if (i !== lines.length - 1) t = t.replace(/[ ]+$/, '')
    if (t) {
      if (i !== lastNonEmpty) t += ' '
      str += t
    }
  })
  return str
}

function containsCyr(node, sf) {
  return CYR.test(node.getText(sf))
}

function inLiteralTypeOrImport(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isTypeNode(p) || ts.isEnumMember(p)) return true
    if (ts.isCaseClause(p) && p.expression === node) return true
  }
  return false
}

function excludedContext(node) {
  const p = node.parent
  if (!p) return false
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) && p.name === node) return true
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true
  if (ts.isCaseClause(p)) return true
  if (ts.isTaggedTemplateExpression(p)) return true
  // аргумент вызова «технического» метода (запросы к БД, сравнения, поиск)
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const c = p.expression
    const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : ''
    if (SKIP_CALLEES.has(name)) return true
    if (name === 'tr') return true
    if (['log', 'warn', 'error', 'debug', 'info'].includes(name) && ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'console') return true
  }
  if (ts.isNewExpression(p) && p.arguments && p.arguments.includes(node) && ts.isIdentifier(p.expression) && ['RegExp', 'Map', 'Set'].includes(p.expression.text)) return true
  return false
}

function varName(expr, i, used) {
  let n = ''
  if (ts.isIdentifier(expr)) n = expr.text
  else if (ts.isPropertyAccessExpression(expr)) n = expr.name.text
  else if (ts.isNonNullExpression(expr) && ts.isIdentifier(expr.expression)) n = expr.expression.text
  else if (ts.isNonNullExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) n = expr.expression.name.text
  if (!n || !/^[A-Za-z_]\w*$/.test(n)) n = 'v' + (i + 1)
  if (RESERVED.has(n)) n = n + '_'
  return n
}

function buildCall(key, subs, sf) {
  keys.add(key)
  if (!subs.length) return `tr(${q(key)})`
  const parts = subs.map((s) => (s.name === s.text ? s.name : `${s.name}: ${s.text}`))
  return `tr(${q(key)}, { ${parts.join(', ')} })`
}

function processFile(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  if (SKIP_FILES.includes(rel)) return
  const src = fs.readFileSync(file, 'utf8')
  if (!CYR.test(src)) return
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const edits = []
  const handled = new Set()

  // 1. серии текста и выражений внутри JSX
  function jsxRuns(children) {
    let run = []
    const flush = () => {
      if (run.length) handleRun(run)
      run = []
    }
    for (const c of children) {
      if (ts.isJsxText(c)) run.push(c)
      else if (ts.isJsxExpression(c) && c.expression && !ts.isJsxExpression(c)) run.push(c)
      else flush()
    }
    flush()
  }

  function handleRun(run) {
    // обрезаем пустые тексты с переводами строк по краям
    const isBlank = (n) => ts.isJsxText(n) && cleanJsx(n.getText(sf)) === ''
    while (run.length && isBlank(run[0])) run.shift()
    while (run.length && isBlank(run[run.length - 1])) run.pop()
    if (!run.some((n) => ts.isJsxText(n) && CYR.test(n.getText(sf)))) return
    if (run.some((n) => ts.isJsxText(n) && n.getText(sf).includes('&'))) { stats.skippedRuns.push(rel + ': & в тексте'); return }
    const exprs = run.filter((n) => ts.isJsxExpression(n))
    const nested = exprs.some((e) => {
      if (ts.isStringLiteral(e.expression) || ts.isNoSubstitutionTemplateLiteral(e.expression)) return CYR.test(e.expression.text)
      return containsCyr(e, sf)
    })
    if (nested) return // вложенные строки обработает общий обход; тексты вокруг оставляем отдельно
    let key = ''
    const subs = []
    const used = new Map()
    run.forEach((n, idx) => {
      if (ts.isJsxText(n)) key += cleanJsx(n.getText(sf))
      else {
        const e = n.expression
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { key += e.text; return }
        const text = e.getText(sf)
        let name = varName(e, subs.length, used)
        const prev = used.get(name)
        if (prev !== undefined && prev !== text) name = 'v' + (subs.length + 1)
        used.set(name, text)
        if (!subs.some((s) => s.name === name)) subs.push({ name, text })
        key += `{{${name}}}`
      }
    })
    const lead = key.match(/^\s*/)[0]
    const trail = key.match(/\s*$/)[0]
    const core = key.trim()
    if (!core || !CYR.test(core)) return
    const call = `{${buildCall(core, subs, sf)}}`
    const rep = (lead ? "{' '}" : '') + call + (trail ? "{' '}" : '')
    edits.push({ start: run[0].getStart(sf, false) === run[0].pos ? run[0].pos : run[0].pos, end: run[run.length - 1].end, rep })
    run.forEach((n) => handled.add(n))
    if (ts.isJsxText(run[0])) { /* pos включает пробелы — ок, пустые края заменяются целиком */ }
    stats.jsx++
  }

  function visit(node) {
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) ) jsxRuns(node.children)
    if (ts.isJsxText(node)) return
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && CYR.test(node.initializer.text) && !node.initializer.text.includes('&')) {
      const key = node.initializer.text.replace(/\s+/g, ' ').trim()
      edits.push({ start: node.initializer.getStart(sf), end: node.initializer.end, rep: `{${buildCall(key, [], sf)}}` })
      stats.attrs++
      return
    }
    if (ts.isJsxAttribute(node)) { ts.forEachChild(node, visit); return }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CYR.test(node.text)) {
      if (!inLiteralTypeOrImport(node) && !excludedContext(node) && !(node.parent && ts.isJsxAttribute(node.parent))) {
        edits.push({ start: node.getStart(sf), end: node.end, rep: buildCall(node.text, [], sf) })
        stats.strings++
      }
      return
    }
    if (ts.isTemplateExpression(node)) {
      const hasCyr = CYR.test(node.head.text) || node.templateSpans.some((s) => CYR.test(s.literal.text))
      const nestedCyr = node.templateSpans.some((s) => CYR.test(s.expression.getText(sf)))
      if (hasCyr && !inLiteralTypeOrImport(node) && !excludedContext(node) && !(ts.isTaggedTemplateExpression(node.parent))) {
        if (nestedCyr) { stats.skippedTemplates.push(rel + ':' + (sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)); ts.forEachChild(node, visit); return }
        let key = node.head.text
        const subs = []
        const used = new Map()
        node.templateSpans.forEach((s, i) => {
          const text = s.expression.getText(sf)
          let name = varName(s.expression, subs.length, used)
          const prev = used.get(name)
          if (prev !== undefined && prev !== text) name = 'v' + (i + 1)
          used.set(name, text)
          if (!subs.some((x) => x.name === name)) subs.push({ name, text })
          key += `{{${name}}}` + s.literal.text
        })
        edits.push({ start: node.getStart(sf), end: node.end, rep: buildCall(key, subs, sf) })
        stats.templates++
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (!edits.length) return
  // JSX-серии: заменяемая область начинается с pos первого узла (включая ведущие пробелы)
  edits.sort((a, b) => b.start - a.start)
  let out = src
  let lastStart = Infinity
  for (const e of edits) {
    if (e.end > lastStart) { console.log('OVERLAP', rel, e.start); continue }
    out = out.slice(0, e.start) + e.rep + out.slice(e.end)
    lastStart = e.start
  }
  out = "import { tr } from '@/lib/tr'\n" + out
  stats.files++
  if (APPLY) fs.writeFileSync(file, out, 'utf8')
}

for (const f of walk(ROOT)) processFile(f)
console.log(JSON.stringify({ ...stats, skippedTemplates: stats.skippedTemplates.length, skippedRuns: stats.skippedRuns.length, keys: keys.size }))
console.log('templates skipped:', stats.skippedTemplates.join(' '))
console.log('runs skipped:', stats.skippedRuns.join(' | '))
fs.writeFileSync(__dirname + '/work/keys.json', JSON.stringify([...keys], null, 0))
