import { Activity, Cable, Camera, Cctv, CircleDot, DoorOpen, Droplet, Droplets, FireExtinguisher, Flashlight, Lamp, LampCeiling, Lightbulb, Network, PanelTop, Plug, Radio, Siren, Thermometer, Tv, Video, Wifi, Wind, Zap } from 'lucide-react'
import { DomeCameraIcon, FisheyeCameraIcon, PtzCameraIcon, type IconComponent } from '@/features/plans/object-icons'
import { tr } from '@/lib/tr'

export type ObjectGeometry = 'point' | 'line'
export type ObjectStatus = 'planned' | 'installed' | 'checked' | 'defect'

/** Подтип внутри типа (камера купольная, цилиндрическая…). Угол обзора рисуется сектором по направлению объекта. */
export interface ObjectVariant {
  code: string
  name: string
  /** Угол обзора в градусах; 360 — круговой обзор */
  fov?: number
  /** Свой значок подтипа; иначе значок типа */
  Icon?: IconComponent
}

/** Характеристика объекта: каждая хранится в `specs` под своим ключом. С `options` выбирается из списка, без него вводится числом. */
export interface SpecField {
  key: string
  label: string
  /** Единица, которая пишется после значения: «4 Мп» */
  unit?: string
  options?: (string | number)[]
}

export interface ObjectType {
  code: string
  name: string
  geometry: ObjectGeometry
  color: string
  /** Значок точки; у линий нет */
  Icon?: IconComponent
  /** Толщина линии в пикселях экрана */
  width?: number
  /** Пунктир (например, канализация) */
  dash?: string
  variants?: ObjectVariant[]
  /** У объекта есть направление (камера, светильник): задаётся поворот и рисуется сектор обзора */
  directional?: boolean
  /** Характеристики, которые можно указать у объекта этого типа */
  specs?: SpecField[]
}

/** Каталог типов. В базе хранятся только коды типа, подтипа и характеристик, поэтому новое добавляется здесь и сразу доступно на всех планах. */
export const OBJECT_TYPES: ObjectType[] = [
  {
    code: 'camera',
    name: tr('Камера'),
    geometry: 'point',
    color: '#7c3aed',
    Icon: Camera,
    directional: true,
    variants: [
      { code: 'dome', name: tr('Купольная (Dome)'), fov: 110, Icon: DomeCameraIcon },
      { code: 'bullet', name: tr('Цилиндрическая (Bullet)'), fov: 80, Icon: Cctv },
      { code: 'ptz', name: tr('Поворотная (PTZ)'), fov: 360, Icon: PtzCameraIcon },
      { code: 'fisheye', name: tr('Рыбий глаз (360°)'), fov: 360, Icon: FisheyeCameraIcon },
      { code: 'box', name: tr('Корпусная (Box)'), fov: 70, Icon: Video },
    ],
    specs: [
      { key: 'mp', label: tr('Разрешение'), unit: tr('Мп'), options: [1, 2, 4, 5, 6, 8, 12] },
      { key: 'lens', label: tr('Объектив'), unit: tr('мм'), options: ['2.8', '4', '6', '8', '2.8–12'] },
    ],
  },
  {
    code: 'panel',
    name: tr('Электрощит'),
    geometry: 'point',
    color: '#d97706',
    Icon: Zap,
    variants: [
      { code: 'distribution', name: tr('Распределительный'), Icon: Zap },
      { code: 'floor', name: tr('Этажный'), Icon: PanelTop },
      { code: 'lowvoltage', name: tr('Слаботочный'), Icon: Cable },
    ],
    specs: [{ key: 'groups', label: tr('Групп'), unit: tr('гр.') }],
  },
  {
    code: 'socket',
    name: tr('Розетка'),
    geometry: 'point',
    color: '#b45309',
    Icon: Plug,
    variants: [
      { code: 'power', name: tr('Силовая'), Icon: Plug },
      { code: 'data', name: tr('Сетевая'), Icon: Network },
      { code: 'tv', name: tr('ТВ'), Icon: Tv },
    ],
  },
  {
    code: 'light',
    name: tr('Светильник'),
    geometry: 'point',
    color: '#ca8a04',
    Icon: Lightbulb,
    directional: true,
    variants: [
      { code: 'ceiling', name: tr('Потолочный'), Icon: LampCeiling },
      { code: 'spot', name: tr('Точечный (Spot)'), fov: 60, Icon: Flashlight },
      { code: 'wall', name: tr('Настенный'), fov: 120, Icon: Lamp },
      { code: 'emergency', name: tr('Аварийный'), Icon: Siren },
    ],
    specs: [{ key: 'watt', label: tr('Мощность'), unit: tr('Вт') }],
  },
  { code: 'hydrant', name: tr('Гидрант'), geometry: 'point', color: '#dc2626', Icon: Droplets },
  {
    code: 'extinguisher',
    name: tr('Огнетушитель'),
    geometry: 'point',
    color: '#e11d48',
    Icon: FireExtinguisher,
    variants: [
      { code: 'powder', name: tr('Порошковый') },
      { code: 'co2', name: tr('Углекислотный') },
    ],
  },
  {
    code: 'valve',
    name: tr('Задвижка'),
    geometry: 'point',
    color: '#0369a1',
    Icon: CircleDot,
    variants: [
      { code: 'ball', name: tr('Шаровой кран') },
      { code: 'gate', name: tr('Задвижка') },
      { code: 'check', name: tr('Обратный клапан') },
    ],
  },
  {
    code: 'sensor',
    name: tr('Датчик'),
    geometry: 'point',
    color: '#0d9488',
    Icon: Radio,
    directional: true,
    variants: [
      { code: 'smoke', name: tr('Дымовой'), Icon: Wind },
      { code: 'heat', name: tr('Тепловой'), Icon: Thermometer },
      { code: 'motion', name: tr('Движения'), fov: 90, Icon: Activity },
      { code: 'leak', name: tr('Протечки'), Icon: Droplet },
      { code: 'door', name: tr('Открытия двери'), Icon: DoorOpen },
    ],
  },
  {
    code: 'wifi',
    name: tr('Точка Wi-Fi'),
    geometry: 'point',
    color: '#4f46e5',
    Icon: Wifi,
    variants: [
      { code: 'ceiling', name: tr('Потолочная') },
      { code: 'wall', name: tr('Настенная') },
    ],
    specs: [{ key: 'band', label: tr('Диапазон'), options: [tr('2,4 ГГц'), tr('5 ГГц'), tr('2,4 + 5 ГГц'), tr('6 ГГц')] }],
  },
  { code: 'pipe_water', name: tr('Водопровод'), geometry: 'line', color: '#0284c7', width: 3 },
  { code: 'pipe_sewer', name: tr('Канализация'), geometry: 'line', color: '#92400e', width: 3, dash: '8 5' },
  { code: 'pipe_fire', name: tr('Противопожарная труба'), geometry: 'line', color: '#dc2626', width: 3 },
  { code: 'cable_power', name: tr('Силовой кабель'), geometry: 'line', color: '#ea580c', width: 2.5 },
  { code: 'cable_low', name: tr('Слаботочный кабель'), geometry: 'line', color: '#7c3aed', width: 2.5, dash: '3 4' },
  { code: 'duct', name: tr('Воздуховод'), geometry: 'line', color: '#64748b', width: 5 },
]

const BY_CODE = new Map(OBJECT_TYPES.map((t) => [t.code, t]))

/** Тип по коду; неизвестный код (тип убрали из каталога) показывается серой точкой или линией. */
export function objectType(code: string, geometry: ObjectGeometry): ObjectType {
  return BY_CODE.get(code) ?? { code, name: code, geometry, color: '#64748b', width: 2.5 }
}

/** Подтип объекта (если он задан и есть в каталоге типа). */
export function objectVariant(t: ObjectType, variant: string | null | undefined): ObjectVariant | undefined {
  return variant ? t.variants?.find((v) => v.code === variant) : undefined
}

/** Значок объекта: у подтипа свой (купольная камера, дымовой датчик), иначе значок типа. */
export function objectIcon(t: ObjectType, variant: string | null | undefined): IconComponent | undefined {
  return objectVariant(t, variant)?.Icon ?? t.Icon
}

/** Цвета на выбор у объекта; пусто — цвет типа. */
export const OBJECT_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#475569', '#111827']

/** Цвет объекта: свой, если задан, иначе цвет типа. */
export const objectColor = (t: ObjectType, color: string | null | undefined): string => color ?? t.color

/** Характеристики подписью: «4 Мп», «2.8 мм». Берутся только известные типу поля, в порядке каталога. */
export function specTexts(t: ObjectType, specs: Record<string, string | number> | null | undefined): string[] {
  if (!specs) return []
  return (t.specs ?? []).flatMap((f) => {
    const v = specs[f.key]
    return v === undefined || v === '' ? [] : [f.unit ? `${v} ${f.unit}` : String(v)]
  })
}

export const OBJECT_STATUS_LABELS: Record<ObjectStatus, string> = {
  planned: tr('по проекту'),
  installed: tr('установлено'),
  checked: tr('проверено'),
  defect: tr('есть дефект'),
}

/** Цвет обода метки по состоянию */
export const OBJECT_STATUS_COLORS: Record<ObjectStatus, string> = {
  planned: '#94a3b8',
  installed: '#2563eb',
  checked: '#16a34a',
  defect: '#dc2626',
}
