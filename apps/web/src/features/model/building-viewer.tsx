import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { tr } from '@/lib/tr'

/**
 * Схематичный 3D-вид здания из GLB (см. scripts/model/ifc-to-glb.mjs): по узлу на этаж, внутри — меши по видам элементов.
 *
 * Навигация — «как в лифте»: без выбранного этажа видно всё здание, наведение подсвечивает этаж, нажатие выбирает его.
 * Выбранный этаж показывается разрезом: всё выше скрыто, стены срезаны на высоте 1,4 м над полом (как на плане этажа),
 * камера плавно смотрит на этаж сверху. Этаж под курсором определяется по высоте попадания в коробку этажа
 * (без перебора миллионов треугольников), поэтому наведение работает мгновенно и на большой модели.
 */
export interface ViewerFloor {
  gid: string
  /** уровень пола в координатах модели, м */
  y: number
  label: string
  /** окраска этажа (#rrggbb) или null */
  color: string | null
}

interface StoreyRuntime {
  gid: string
  node: THREE.Object3D
  box: THREE.Box3
  /** рамка для камеры: основная масса этажа без далёких одиночных элементов (подпорные стены участка, площадки) */
  frame: THREE.Box3
  materials: { mat: THREE.MeshLambertMaterial; base: THREE.Color; tintable: boolean }[]
}

const CUT_HEIGHT = 1.4

/**
 * Рамка плана этажа по основной массе вершин (от 2-го до 98-го процентиля по X и Z): одиночные далёкие элементы —
 * подпорная стена участка, отдельная площадка — не раздувают кадр, и этаж не получается мелким посреди пустоты.
 */
function robustFrame(node: THREE.Object3D): THREE.Box3 | null {
  const xs: number[] = []
  const zs: number[] = []
  const v = new THREE.Vector3()
  node.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    const step = Math.max(1, Math.floor(pos.count / 20000))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      xs.push(v.x)
      zs.push(v.z)
    }
  })
  if (xs.length < 10) return null
  xs.sort((a, b) => a - b)
  zs.sort((a, b) => a - b)
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]
  return new THREE.Box3(new THREE.Vector3(q(xs, 0.02), 0, q(zs, 0.02)), new THREE.Vector3(q(xs, 0.98), 0, q(zs, 0.98)))
}
const TINTABLE = new Set(['wall', 'slab', 'structure', 'other', 'stair'])

export function BuildingViewer({
  buffer,
  floors,
  selected,
  onSelect,
  onReady,
}: {
  buffer: ArrayBuffer
  floors: ViewerFloor[]
  selected: string | null
  onSelect: (gid: string) => void
  onReady?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{
    storeys: Map<string, StoreyRuntime>
    setState: (floors: ViewerFloor[], selected: string | null, hover: string | null) => void
    focus: (gid: string | null) => void
  } | null>(null)
  const [hover, setHover] = useState<{ gid: string; x: number; y: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef({ floors, selected, onSelect, hover: null as string | null })
  latest.current.floors = floors
  latest.current.selected = selected
  latest.current.onSelect = onSelect

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.localClippingEnabled = true
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d939c, 2.4))
    const sun = new THREE.DirectionalLight(0xffffff, 1.5)
    sun.position.set(0.8, 2, 1.3)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.screenSpacePanning = true
    controls.maxPolarAngle = Math.PI * 0.495
    controls.minDistance = 5
    controls.maxDistance = 1500

    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)
    const storeys = new Map<string, StoreyRuntime>()
    const whole = new THREE.Box3()

    let frame = 0
    const render = () => {
      frame = 0
      const moving = controls.update()
      renderer.render(scene, camera)
      if (moving || tween) request()
    }
    const request = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(render)
    }
    controls.addEventListener('change', request)

    const resize = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      request()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()

    // плавный перелёт камеры
    let tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; ms: number } | null = null
    const fly = (pos: THREE.Vector3, target: THREE.Vector3) => {
      if (reduceMotion) {
        camera.position.copy(pos)
        controls.target.copy(target)
        request()
        return
      }
      tween = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, start: performance.now(), ms: 550 }
      const step = () => {
        if (!tween || disposed) return
        const k = Math.min(1, (performance.now() - tween.start) / tween.ms)
        const e = 1 - Math.pow(1 - k, 3)
        camera.position.lerpVectors(tween.from, tween.to, e)
        controls.target.lerpVectors(tween.tFrom, tween.tTo, e)
        request()
        if (k < 1) requestAnimationFrame(step)
        else tween = null
      }
      requestAnimationFrame(step)
    }
    const fitDistance = (size: number) => size / 2 / Math.tan((camera.fov * Math.PI) / 360) / Math.min(1, camera.aspect) * 1.15

    const focus = (gid: string | null) => {
      if (whole.isEmpty()) return
      const s = gid ? storeys.get(gid) : undefined
      if (!s) {
        const c = whole.getCenter(new THREE.Vector3())
        const size = whole.getSize(new THREE.Vector3())
        const d = fitDistance(Math.max(size.y, Math.hypot(size.x, size.z) * 0.8))
        fly(c.clone().add(new THREE.Vector3(0.75, 0.42, 1).normalize().multiplyScalar(d)), c)
        return
      }
      const c = s.frame.getCenter(new THREE.Vector3())
      c.y = s.box.min.y + 0.5
      const size = s.frame.getSize(new THREE.Vector3())
      // этаж повёрнут к камере под углом и виден в перспективе — берём диагональ плана с запасом
      const d = fitDistance(Math.hypot(size.x, size.z)) * 1.1
      fly(c.clone().add(new THREE.Vector3(0.25, 1, 0.5).normalize().multiplyScalar(d)), c)
    }

    const setState = (list: ViewerFloor[], sel: string | null, hov: string | null) => {
      const selFloor = sel ? list.find((f) => f.gid === sel) : undefined
      cut.constant = selFloor ? selFloor.y + CUT_HEIGHT : 1e6
      const colorOf = new Map(list.map((f) => [f.gid, f.color]))
      const tmp = new THREE.Color()
      for (const s of storeys.values()) {
        const floor = list.find((f) => f.gid === s.gid)
        // при выбранном этаже выше него ничего не видно; ниже — видно (подиум, соседние объёмы), но приглушённо
        s.node.visible = !selFloor || (floor ? floor.y <= selFloor.y + 0.01 : s.box.min.y <= selFloor.y + 0.01)
        const below = !!selFloor && s.gid !== sel
        const tint = colorOf.get(s.gid)
        for (const m of s.materials) {
          m.mat.color.copy(m.base)
          if (tint && m.tintable) m.mat.color.lerp(tmp.set(tint), 0.6)
          if (below) m.mat.color.lerp(tmp.set(0xd4d4d8), 0.55)
          m.mat.emissive.setHex(s.gid === hov && s.gid !== sel ? 0x2b3a55 : 0x000000)
        }
      }
      request()
    }

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    loader.parse(
      buffer.slice(0),
      '',
      (gltf) => {
        if (disposed) return
        const root = gltf.scene
        for (const node of [...root.children]) {
          const gid = node.userData?.gid as string | undefined
          if (!gid) continue
          const mats: StoreyRuntime['materials'] = []
          node.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (!mesh.isMesh) return
            const src = mesh.material as THREE.MeshStandardMaterial
            const transparent = src.transparent || src.opacity < 1
            const mat = new THREE.MeshLambertMaterial({
              color: src.color.clone(),
              flatShading: true,
              side: THREE.DoubleSide,
              transparent,
              opacity: src.opacity,
              depthWrite: !transparent,
              clippingPlanes: [cut],
            })
            src.dispose()
            mesh.material = mat
            mats.push({ mat, base: src.color.clone(), tintable: TINTABLE.has(String(o.parent?.userData?.category ?? o.userData?.category ?? o.name)) })
          })
          storeys.set(gid, { gid, node, box: new THREE.Box3(), frame: new THREE.Box3(), materials: mats })
        }
        scene.add(root)
        root.updateMatrixWorld(true)
        // коробка этажа: план — по его геометрии, высота — от его пола до пола следующего этажа
        const ordered = [...storeys.values()]
          .map((s) => ({ s, y: Number(s.node.userData.y ?? 0) }))
          .sort((a, b) => a.y - b.y)
        ordered.forEach(({ s, y }, i) => {
          const b = new THREE.Box3().setFromObject(s.node)
          if (b.isEmpty()) return
          const top = i + 1 < ordered.length ? ordered[i + 1].y : Math.max(b.max.y, y + 3.5)
          b.min.y = y
          b.max.y = Math.max(top, y + 0.3)
          s.box.copy(b)
          s.frame.copy(robustFrame(s.node) ?? b)
          s.frame.min.y = b.min.y
          s.frame.max.y = b.max.y
          whole.union(new THREE.Box3().setFromObject(s.node))
        })
        // ближняя и дальняя плоскости камеры — по размеру здания
        const size = whole.getSize(new THREE.Vector3()).length()
        camera.near = Math.max(0.2, size / 2000)
        camera.far = size * 8
        camera.updateProjectionMatrix()
        api.current = { storeys, setState, focus }
        setState(latest.current.floors, latest.current.selected, null)
        const c = whole.getCenter(new THREE.Vector3())
        controls.target.copy(c)
        camera.position.copy(c.clone().add(new THREE.Vector3(0.75, 0.42, 1).normalize().multiplyScalar(fitDistance(whole.getSize(new THREE.Vector3()).y * 1.1))))
        focus(latest.current.selected)
        request()
        onReady?.()
      },
      () => setFailed(true),
    )

    // этаж под указателем: ближайшая коробка видимого этажа, которую пересекает луч
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()
    const pick = (clientX: number, clientY: number): string | null => {
      const r = renderer.domElement.getBoundingClientRect()
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      let best: string | null = null
      let bestD = Infinity
      const sel = latest.current.floors.find((f) => f.gid === latest.current.selected)
      for (const s of storeys.values()) {
        if (!s.node.visible || s.box.isEmpty()) continue
        if (!latest.current.floors.some((f) => f.gid === s.gid)) continue
        // у выбранного этажа срезан верх — коробка тоже по срезу
        const box = sel && s.gid === sel.gid ? s.box.clone().set(s.box.min, new THREE.Vector3(s.box.max.x, Math.min(s.box.max.y, sel.y + CUT_HEIGHT), s.box.max.z)) : s.box
        if (ray.ray.intersectBox(box, hit)) {
          const d = hit.distanceTo(ray.ray.origin)
          if (d < bestD) {
            bestD = d
            best = s.gid
          }
        }
      }
      return best
    }

    let down: { x: number; y: number; t: number } | null = null
    let moveFrame = 0
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() }
    }
    const onUp = (e: PointerEvent) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 6) return
      const gid = pick(e.clientX, e.clientY)
      if (gid) latest.current.onSelect(gid)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || down) return
      if (moveFrame) cancelAnimationFrame(moveFrame)
      const { clientX, clientY } = e
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0
        const gid = pick(clientX, clientY)
        if (gid !== latest.current.hover) {
          latest.current.hover = gid
          setState(latest.current.floors, latest.current.selected, gid)
        }
        const r = el.getBoundingClientRect()
        setHover(gid ? { gid, x: clientX - r.left, y: clientY - r.top } : null)
      })
    }
    const onLeave = () => {
      latest.current.hover = null
      setHover(null)
      setState(latest.current.floors, latest.current.selected, null)
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)

    return () => {
      disposed = true
      api.current = null
      if (frame) cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
    // модель пересоздаётся только при смене файла; остальное — через api.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer])

  useEffect(() => {
    api.current?.setState(floors, selected, latest.current.hover)
  }, [floors, selected])
  useEffect(() => {
    api.current?.focus(selected)
  }, [selected])

  const hoverLabel = hover ? floors.find((f) => f.gid === hover.gid)?.label : undefined
  return (
    <div ref={host} className="relative size-full select-none overflow-hidden" style={{ cursor: hover ? 'pointer' : 'grab' }}>
      {hover && hoverLabel && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow"
          style={{ left: hover.x + 14, top: hover.y + 10 }}
        >
          {hoverLabel}
        </div>
      )}
      {failed && <p className="absolute inset-0 grid place-items-center text-sm text-destructive">{tr('Не удалось открыть файл модели')}</p>}
    </div>
  )
}
