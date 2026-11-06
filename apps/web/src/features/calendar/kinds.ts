import { tr } from '@/lib/tr'
import { Diamond, FileCheck, FileText, Flag, Hourglass, ListChecks, CalendarCheck, CalendarClock, Lock, Play, SearchCheck, Users, Zap } from 'lucide-react'
import type { KindId, KindInfo } from '@/features/calendar/types'

// Классы записаны целиком, чтобы их видел Tailwind. Тип различается и значком, и подписью — не только цветом.
export const KINDS: Record<KindId, KindInfo> = {
  task_due: {
    label: tr('Срок задачи'),
    icon: ListChecks,
    chip: 'border-l-sky-500 bg-sky-500/10 text-sky-900 dark:text-sky-100',
    dot: 'bg-sky-500',
    defaultOn: true,
  },
  task_need: {
    label: tr('Нужно к дате'),
    icon: Hourglass,
    chip: 'border-l-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-100',
    dot: 'bg-amber-500',
    defaultOn: true,
  },
  meeting: {
    label: tr('Совещание'),
    icon: Users,
    chip: 'border-l-violet-500 bg-violet-500/10 text-violet-900 dark:text-violet-100',
    dot: 'bg-violet-500',
    defaultOn: true,
  },
  milestone: {
    label: tr('Веха графика'),
    icon: Diamond,
    chip: 'border-l-emerald-500 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
    dot: 'bg-emerald-500',
    defaultOn: true,
  },
  activity_critical: {
    label: tr('Критическая работа'),
    icon: Zap,
    chip: 'border-l-rose-500 bg-rose-500/10 text-rose-900 dark:text-rose-100',
    dot: 'bg-rose-500',
    defaultOn: true,
  },
  activity_start: {
    label: tr('Старт работы'),
    icon: Play,
    chip: 'border-l-teal-500 bg-teal-500/10 text-teal-900 dark:text-teal-100',
    dot: 'bg-teal-500',
    defaultOn: false,
  },
  activity_finish: {
    label: tr('Окончание работы'),
    icon: Flag,
    chip: 'border-l-cyan-500 bg-cyan-500/10 text-cyan-900 dark:text-cyan-100',
    dot: 'bg-cyan-500',
    defaultOn: false,
  },
  week_plan: {
    label: tr('План недели'),
    icon: CalendarCheck,
    chip: 'border-l-indigo-500 bg-indigo-500/10 text-indigo-900 dark:text-indigo-100',
    dot: 'bg-indigo-500',
    defaultOn: true,
  },
  doc_ack: {
    label: tr('Ознакомление с документом'),
    icon: FileCheck,
    chip: 'border-l-orange-500 bg-orange-500/10 text-orange-900 dark:text-orange-100',
    dot: 'bg-orange-500',
    defaultOn: true,
  },
  doc_issued: {
    label: tr('Выпуск документа'),
    icon: FileText,
    chip: 'border-l-slate-500 bg-slate-500/10 text-slate-800 dark:text-slate-200',
    dot: 'bg-slate-500',
    defaultOn: false,
  },
  inspection: {
    label: tr('Инспекция'),
    icon: SearchCheck,
    chip: 'border-l-lime-600 bg-lime-500/10 text-lime-900 dark:text-lime-100',
    dot: 'bg-lime-600',
    defaultOn: true,
  },
  inspection_due: {
    label: tr('Срок инспекции'),
    icon: CalendarClock,
    chip: 'border-l-pink-500 bg-pink-500/10 text-pink-900 dark:text-pink-100',
    dot: 'bg-pink-500',
    defaultOn: true,
  },
  // личное видно только владельцу; в рабочих календарях выключено по умолчанию, в личном календаре включено
  personal: {
    label: tr('Личное'),
    icon: Lock,
    chip: 'border-l-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-900 dark:text-fuchsia-100',
    dot: 'bg-fuchsia-500',
    defaultOn: false,
  },
}

/** Просроченное выделяется красным поверх цвета типа. */
export const OVERDUE_CHIP = 'border-l-red-600 bg-red-500/15 text-red-900 dark:text-red-100'
