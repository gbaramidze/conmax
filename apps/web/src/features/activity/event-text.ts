import { tr } from '@/lib/tr'
import { currentLocale } from '@/lib/i18n'
const FIELD_LABELS: Record<string, string> = {
  name: tr('название'),
  title: tr('название'),
  code: tr('код'),
  kind: tr('тип'),
  status: tr('статус'),
  address: tr('адрес'),
  priority: tr('приоритет'),
  visibility: tr('видимость'),
  due_date: tr('срок'),
  planned_start: tr('плановый старт'),
  planned_finish: tr('плановое завершение'),
  actual_start: tr('фактический старт'),
  actual_finish: tr('фактическое завершение'),
  manager_user_id: tr('руководитель'),
  assignee_id: tr('исполнитель'),
  location_id: tr('локация'),
  discipline_id: tr('дисциплина'),
  organization_id: tr('организация'),
  client_org_id: tr('заказчик'),
  need_by_date: tr('нужно до'),
  estimate_hours: tr('оценка, ч'),
  spent_hours: tr('затрачено, ч'),
  tags: tr('теги'),
  timezone: tr('часовой пояс'),
  currency: tr('валюта'),
  deleted_at: tr('удаление'),
  'settings.progress_approval': tr('подтверждение факта после обхода'),
}

const VALUE_LABELS: Record<string, string> = {
  low: tr('низкий'),
  normal: tr('обычный'),
  high: tr('высокий'),
  critical: tr('критичный'),
  internal: tr('только команда'),
  external: tr('видна внешним'),
}

const CHANGE_STATUS_LABELS: Record<string, string> = {
  draft: tr('черновик'),
  assessment: tr('на оценке'),
  approval: tr('на согласовании'),
  approved: tr('утверждён'),
  rejected: tr('отклонён'),
  implemented: tr('внедрён'),
  cancelled: tr('отменён'),
}
const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: tr('черновик'),
  submitted: tr('на согласовании'),
  approved: tr('согласована'),
  rejected: tr('отклонена'),
  ordered: tr('заказана'),
  delivered: tr('поставлена'),
  cancelled: tr('отменена'),
}
const RFQ_STATUS_LABELS: Record<string, string> = {
  open: tr('открыт'),
  awarded: tr('присуждён'),
  cancelled: tr('отменён'),
}
const RISK_STATUS_LABELS: Record<string, string> = {
  open: tr('открыт'),
  monitoring: tr('наблюдаем'),
  occurred: tr('наступил'),
  closed: tr('закрыт'),
}

const ROLE_LABELS: Record<string, string> = {
  project_manager: tr('Руководитель проекта'),
  chief_engineer: tr('ГИП'),
  pto: tr('ПТО'),
  foreman: tr('Прораб'),
  master: tr('Мастер'),
  designer: tr('Проектировщик'),
  economist: tr('Экономист'),
  safety_officer: tr('Специалист по ОТ'),
  observer: tr('Наблюдатель'),
  subcontractor: tr('Субподрядчик'),
  client: tr('Заказчик'),
}

export interface EventContext {
  userName: (id: string) => string
  reasonName: (code: string) => string
  locationName: (id: string) => string
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === ''

/** Описание события ленты (безличная форма). */
export function describeEvent(type: string, changes: Record<string, unknown>, ctx: EventContext): string {
  const value = (field: string, v: unknown): string => {
    if (isEmpty(v)) return '—'
    if (field === 'assignee_id' || field === 'manager_user_id') return ctx.userName(String(v))
    if (field === 'location_id') return ctx.locationName(String(v))
    if (typeof v === 'boolean') return v ? tr('включено') : tr('выключено')
    // словарь или список целиком не показываем как [object Object]
    if (typeof v === 'object') return JSON.stringify(v)
    return VALUE_LABELS[String(v)] ?? String(v)
  }

  switch (type) {
    case 'created':
      if (changes.key) return tr('Задача создана ({{key}})', { key: changes.key })
      return changes.title ? tr('Создано: «{{v1}}»', { v1: String(changes.title) }) : tr('Проект создан')
    case 'rescheduled': {
      const at = (v: unknown) => new Date(String(v)).toLocaleString(currentLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      return tr('Совещание перенесено: {{from}} → {{to}}{{series}}', { from: at(changes.from), to: at(changes.to), series: changes.scope === 'following' ? tr(' (расписание серии изменено)') : '' })
    }
    case 'recording_added': {
      const sec = Number(changes.duration_sec ?? 0)
      return tr('Сохранена аудиозапись ({{v1}} мин {{v2}} с)', { v1: Math.floor(sec / 60), v2: sec % 60 })
    }
    case 'dates_changed': {
      const d = (v: unknown) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString(currentLocale()) : '—')
      return tr('Сроки проекта: {{a}} – {{b}} → {{c}} – {{d}}{{reason}}', { a: d(changes.from_start), b: d(changes.from_finish), c: d(changes.to_start), d: d(changes.to_finish), reason: changes.reason ? tr('. Основание: {{v1}}', { v1: String(changes.reason) }) : '' })
    }
    case 'recording_deleted':
      return tr('Аудиозапись удалена')
    case 'action_added':
      return tr('Выдано поручение {{v1}}: {{v2}}', { v1: String(changes.key), v2: String(changes.title) })
    case 'member_added':
      return tr('Добавлен участник {{v1}} ({{v2}})', { v1: ctx.userName(String(changes.user_id)), v2: ROLE_LABELS[String(changes.role)] ?? changes.role })
    case 'member_removed':
      return tr('Участник {{v1}} убран из проекта', { v1: ctx.userName(String(changes.user_id)) })
    case 'walk_submitted': {
      const n = (k: string) => Number(changes[k] ?? 0)
      return tr('Обход завершён: внесён факт по {{v1}} поз., не работали — {{v2}}, не удалось — {{v3}}', { v1: n('progress'), v2: n('no_work'), v3: n('blocked') })
    }
    case 'walk_approved':
      return tr('Факт обхода подтверждён')
    case 'check_submitted': {
      const n = (k: string) => Number(changes[k] ?? 0)
      const bad = n('minor') + n('major')
      return tr('Проверка завершена: совпало — {{match}}, расхождений — {{bad}}{{blocked}}', { match: n('match'), bad, blocked: n('blocked') ? tr(', не удалось проверить — {{v1}}', { v1: n('blocked') }) : '' })
    }
    case 'version_added':
      return tr('Загружена версия {{v1}} (черновик)', { v1: changes.revision ? String(changes.revision) : '№' + String(changes.version_no) })
    case 'version_published': {
      const now = changes.revision ? String(changes.revision) : '№' + String(changes.version_no)
      return tr('Выпущена ревизия {{now}}{{was}}', { now, was: changes.previous ? tr(' (было {{v1}})', { v1: String(changes.previous) }) : '' })
    }
    case 'overdue_escalated': {
      const who = changes.user_id ? ctx.userName(String(changes.user_id)) : tr('участник')
      const step = Number(changes.step ?? 0)
      return step === 0 ? tr('Срок прошёл: уведомлён {{who}}', { who }) : tr('Просрочка эскалирована: уведомлён {{who}}', { who })
    }
    case 'discrepancy_resolved':
      return changes.resolution === 'accept_observed' ? tr('Расхождение закрыто: принят проверенный итог') : tr('Расхождение закрыто: принято заявленное')
    case 'status_changed': {
      // совещание: {from, to} кодами этапов; задача: status = [из, в]
      if (typeof changes.to === 'string') {
        const stage: Record<string, string> = { scheduled: tr('запланировано'), in_progress: tr('идёт'), minutes_draft: tr('протокол в работе'), published: tr('протокол опубликован'), cancelled: tr('отменено') }
        return tr('Совещание: {{v1}} → {{v2}}', { v1: stage[String(changes.from)] ?? changes.from, v2: stage[changes.to] ?? changes.to })
      }
      const [from, to] = changes.status as [string, string]
      const reason = changes.reason_code ? tr(' — причина: {{v1}}', { v1: ctx.reasonName(String(changes.reason_code)) }) : ''
      return tr('Статус: {{from}} → {{to}}{{reason}}', { from, to, reason })
    }
    case 'inspection_issued':
      return tr('Выдан отчёт об инспекции {{key}}: «{{title}}», итог {{result}}', { key: String(changes.key), title: String(changes.title), result: String(changes.result ?? '—') })
    case 'inspection_reopened':
      return tr('Отчёт об инспекции {{key}} открыт заново: «{{title}}»', { key: String(changes.key), title: String(changes.title) })
    case 'risk_created':
      return tr('Записан риск {{key}}: «{{title}}» (оценка {{score}})', { key: String(changes.key), title: String(changes.title), score: Number(changes.score ?? 0) })
    case 'risk_status':
      return tr('Риск {{key}}: статус {{from}} → {{to}}', { key: String(changes.key), from: RISK_STATUS_LABELS[String(changes.from)] ?? String(changes.from), to: RISK_STATUS_LABELS[String(changes.to)] ?? String(changes.to) })
    case 'rfq_status': {
      const note = changes.note ? tr(' — {{note}}', { note: String(changes.note) }) : ''
      if (!changes.from) return tr('Запрос цен {{key}}: «{{title}}» создан', { key: String(changes.key), title: String(changes.title) })
      return tr('Запрос цен {{key}}: {{from}} → {{to}}{{note}}', { key: String(changes.key), from: RFQ_STATUS_LABELS[String(changes.from)] ?? String(changes.from), to: RFQ_STATUS_LABELS[String(changes.to)] ?? String(changes.to), note })
    }
    case 'request_status': {
      const note = changes.note ? tr(' — {{note}}', { note: String(changes.note) }) : ''
      if (!changes.from) return tr('Заявка на материалы {{key}}: «{{title}}» записана', { key: String(changes.key), title: String(changes.title) })
      const over = changes.over_budget ? tr(' (сверх бюджета)') : ''
      return tr('Заявка на материалы {{key}}: {{from}} → {{to}}{{over}}{{note}}', { key: String(changes.key), from: REQUEST_STATUS_LABELS[String(changes.from)] ?? String(changes.from), to: REQUEST_STATUS_LABELS[String(changes.to)] ?? String(changes.to), over, note })
    }
    case 'change_status': {
      const note = changes.note ? tr(' — {{note}}', { note: String(changes.note) }) : ''
      if (!changes.from) return tr('Запрос на изменение {{key}}: «{{title}}» записан', { key: String(changes.key), title: String(changes.title) })
      return tr('Запрос на изменение {{key}}: {{from}} → {{to}}{{note}}', { key: String(changes.key), from: CHANGE_STATUS_LABELS[String(changes.from)] ?? String(changes.from), to: CHANGE_STATUS_LABELS[String(changes.to)] ?? String(changes.to), note })
    }
    case 'field_changed': {
      const isDict = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
      // настройки проекта приходят целым словарём: показываем только то, что изменилось, по ключам
      const flat: [string, unknown, unknown][] = []
      for (const [field, pair] of Object.entries(changes)) {
        const [from, to] = pair as [unknown, unknown]
        if (field === 'settings' && (isDict(from) || isDict(to))) {
          const a = isDict(from) ? from : {}
          const b = isDict(to) ? to : {}
          for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) flat.push([`settings.${k}`, a[k], b[k]])
        } else flat.push([field, from, to])
      }
      const parts = flat.map(([field, from, to]) => `${FIELD_LABELS[field] ?? (field.startsWith('settings.') ? tr('настройка {{key}}', { key: field.slice(9) }) : field)}: ${value(field, from)} → ${value(field, to)}`)
      return tr('Изменено — {{v1}}', { v1: parts.join('; ') })
    }
    default:
      return type
  }
}
