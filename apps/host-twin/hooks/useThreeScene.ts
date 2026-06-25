"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import {
  buildMachineGroup, buildMachineGroupScaled, buildRobotMesh, buildPathLine,
  addSelectionOutline, removeSelectionOutline, applyComponentFault,
  disposeScene, loadGLTFModel, disposeGLTFModel,
} from "@/lib/threeHelpers"
import { useFactoryStore } from "@/store/factoryStore"
import type { MachineType, EntityScale } from "@sdf/types"

/** 그리드 스냅: 값을 unit 단위로 반올림 */
function snapToGrid(value: number, unit: number): number {
  return Math.round(value / unit) * unit
}

// Default patrol circuits per robot — overridden by backend robot_path when selected
const DEFAULT_PATROLS: Record<string, [number, number][]> = {
  R1: [[10,10],[14,10],[14,14],[10,14],[6,14],[6,10],[6,6],[10,6],[10,10]],
  R2: [[5,5],[9,5],[9,9],[5,9],[5,5]],
  R3: [[15,5],[19,5],[19,9],[15,9],[15,14],[19,14],[19,5]],
}

export interface RobotPositionRef {
  [robotId: string]: { x: number; y: number }
}
export interface MachineGroupRef {
  [machineId: string]: THREE.Group
}
export interface RobotMeshRef {
  [robotId: string]: THREE.Mesh
}

interface RobotWaypoints {
  waypoints: [number, number][]
  index: number
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})
  const machineGroupsRef = useRef<MachineGroupRef>({})
  const robotMeshesRef = useRef<RobotMeshRef>({})
  const pathLinesRef = useRef<Record<string, THREE.Line>>({})
  const ghostRef = useRef<THREE.Group | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const robotWaypointsRef = useRef<Record<string, RobotWaypoints>>({})
  const gltfLoadingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let rafId: number
    let renderer: THREE.WebGLRenderer
    let controls: OrbitControls

    const setup = () => {
      // Read dimensions after layout has settled
      const w = Math.max(canvas.clientWidth, 1)
      const h = Math.max(canvas.clientHeight, 1)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x111827)
      sceneRef.current = scene

      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000)
      camera.position.set(10, 20, 20)
      camera.lookAt(10, 0, 10)

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      renderer.setSize(w, h, false)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      controls.dampingFactor = 0.1
      controls.target.set(10, 0, 10)
      controls.update()

      scene.add(new THREE.AmbientLight(0xffffff, 0.6))
      const dir = new THREE.DirectionalLight(0xffffff, 0.8)
      dir.position.set(10, 20, 10)
      scene.add(dir)

      const grid = new THREE.GridHelper(22, 22, 0x374151, 0x1f2937)
      grid.position.set(10, 0, 10)
      scene.add(grid)

      const floorGeo = new THREE.PlaneGeometry(22, 22)
      const floorMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      const floor = new THREE.Mesh(floorGeo, floorMat)
      floor.rotation.x = -Math.PI / 2
      floor.position.set(10, 0, 10)
      floor.name = "__floor__"
      scene.add(floor)

      const raycaster = new THREE.Raycaster()

      // Sync renderer/camera when container resizes
      const resizeObserver = new ResizeObserver(() => {
        const rw = Math.max(canvas.clientWidth, 1)
        const rh = Math.max(canvas.clientHeight, 1)
        renderer.setSize(rw, rh, false)
        camera.aspect = rw / rh
        camera.updateProjectionMatrix()
      })
      resizeObserver.observe(canvas)

      let mouseDownPos = { x: 0, y: 0 }

      const onMouseDown = (e: MouseEvent) => {
        mouseDownPos = { x: e.clientX, y: e.clientY }
      }

      const onMouseMove = (e: MouseEvent) => {
        const store = useFactoryStore.getState()
        if (!store.placementMode) {
          if (ghostRef.current) { scene.remove(ghostRef.current); ghostRef.current = null }
          return
        }
        const rect = canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObject(floor)
        if (!hits.length) return
        const { x, z } = hits[0].point
        if (!ghostRef.current) {
          const type = store.placementMode.type
          const ghost = type === "robot"
            ? new THREE.Group()
            : buildMachineGroup("ghost", type as MachineType)
          ghost.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              const mat = (obj.material as THREE.MeshStandardMaterial).clone()
              mat.opacity = 0.4
              mat.transparent = true
              obj.material = mat
            }
          })
          ghostRef.current = ghost
          scene.add(ghost)
        }
        ghostRef.current.position.set(x, 0, z)
        const tooClose = store.placedEntities.some((e) => {
          const dx = e.x - x, dz = e.z - z
          return Math.sqrt(dx * dx + dz * dz) < 1.5
        })
        ghostRef.current.traverse((obj) => {
          if (obj instanceof THREE.Mesh)
            (obj.material as THREE.MeshStandardMaterial).color.setHex(tooClose ? 0xef4444 : 0x3b82f6)
        })
      }

      const onMouseUp = (e: MouseEvent) => {
        const dx = e.clientX - mouseDownPos.x
        const dy = e.clientY - mouseDownPos.y
        if (Math.sqrt(dx * dx + dy * dy) > 5) return

        const store = useFactoryStore.getState()
        const rect = canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(ndc, camera)

        if (store.placementMode) {
          const hits = raycaster.intersectObject(floor)
          if (!hits.length) return
          const { x, z } = hits[0].point
          const tooClose = store.placedEntities.some((en) => {
            const ddx = en.x - x, ddz = en.z - z
            return Math.sqrt(ddx * ddx + ddz * ddz) < 1.5
          })
          if (tooClose) return
          store.placeEntity(store.placementMode.poolId, store.placementMode.type, x, z, store.placementMode.label)
          if (ghostRef.current) { scene.remove(ghostRef.current); ghostRef.current = null }
          return
        }

        const allMeshes: THREE.Object3D[] = [
          ...Object.values(machineGroupsRef.current),
          ...Object.values(robotMeshesRef.current),
        ]
        const hits = raycaster.intersectObjects(allMeshes, true)
        const prev = store.selectedEntityId
        if (prev) {
          const prevObj = machineGroupsRef.current[prev] ?? robotMeshesRef.current[prev]
          if (prevObj) removeSelectionOutline(prevObj)
        }
        if (!hits.length) { store.selectEntity(null); return }
        let obj: THREE.Object3D | null = hits[0].object
        while (obj && !obj.userData.entityId) obj = obj.parent ?? null
        if (!obj?.userData.entityId) return
        store.selectEntity(obj.userData.entityId as string)
        addSelectionOutline(obj)
      }

      const onDblClick = (e: MouseEvent) => {
        const store = useFactoryStore.getState()
        if (store.placementMode) return
        const rect = canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObjects(Object.values(machineGroupsRef.current), true)
        if (!hits.length) return
        let obj: THREE.Object3D | null = hits[0].object
        while (obj && !obj.userData.entityId) obj = obj.parent ?? null
        if (!obj?.userData.entityId) return
        store.moveEntity(obj.userData.entityId as string)
      }

      canvas.addEventListener("mousedown", onMouseDown)
      canvas.addEventListener("mousemove", onMouseMove)
      canvas.addEventListener("mouseup", onMouseUp)
      canvas.addEventListener("dblclick", onDblClick)

      // ── TransformControls (저작 모드) ──────────────────────────────
      const transformControls = new TransformControls(camera, canvas)
      transformControls.setMode("translate")
      transformControls.showY = false // X/Z 축만 허용
      // Three.js 0.167+ : TransformControls는 씬에 직접 add 불가 → getHelper() 사용
      const tcHelper = transformControls.getHelper()
      scene.add(tcHelper)

      // 드래그 중엔 OrbitControls 비활성화
      transformControls.addEventListener("dragging-changed", (e) => {
        controls.enabled = !(e.value as boolean)
      })

      let transformTarget: THREE.Object3D | null = null

      // 드래그 완료 시 그리드 스냅 적용 후 스토어 반영
      transformControls.addEventListener("mouseUp", () => {
        if (!transformTarget) return
        const store = useFactoryStore.getState()
        const unit = store.snapUnit
        const snappedX = snapToGrid(transformTarget.position.x, unit)
        const snappedZ = snapToGrid(transformTarget.position.z, unit)
        // 그리드 범위 클램핑 (0~20)
        const clampedX = Math.max(0.5, Math.min(19.5, snappedX))
        const clampedZ = Math.max(0.5, Math.min(19.5, snappedZ))
        transformTarget.position.set(clampedX, transformTarget.position.y, clampedZ)
        const entityId = transformTarget.userData.entityId as string
        store.updateEntityPosition(entityId, clampedX, clampedZ)
      })

      // 저작 모드 클릭: Raycasting → TransformControls 연결
      const onEditModeClick = (e: MouseEvent) => {
        const store = useFactoryStore.getState()
        if (!store.editMode) return
        const dx = e.clientX - mouseDownPos.x
        const dy = e.clientY - mouseDownPos.y
        if (Math.sqrt(dx * dx + dy * dy) > 5) return

        const rect = canvas.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        raycaster.setFromCamera(ndc, camera)
        const allObjects = [
          ...Object.values(machineGroupsRef.current),
          ...Object.values(robotMeshesRef.current),
        ]
        const hits = raycaster.intersectObjects(allObjects, true)
        if (!hits.length) {
          transformControls.detach()
          transformTarget = null
          return
        }
        let obj: THREE.Object3D | null = hits[0].object
        while (obj && !obj.userData.entityId) obj = obj.parent ?? null
        if (!obj) return
        transformControls.attach(obj)
        transformTarget = obj
      }
      canvas.addEventListener("mouseup", onEditModeClick)

      // editMode 변화 감지: OFF 시 TransformControls 해제
      const unsubEditMode = useFactoryStore.subscribe((state) => {
        if (!state.editMode) {
          transformControls.detach()
          transformTarget = null
        }
      })

      // entityScales 변화 감지: 스케일 변경 시 group.scale 동기화
      const unsubScales = useFactoryStore.subscribe((state) => {
        for (const [entityId, scale] of Object.entries(state.entityScales)) {
          const group = machineGroupsRef.current[entityId]
          if (group) group.scale.set(scale.x, scale.y, scale.z)
        }
      })

      const clock = new THREE.Clock()
      const ROBOT_SPEED = 0.5 // units per second — 1 grid per 2 seconds

      const animate = () => {
        rafId = requestAnimationFrame(animate)
        const delta = clock.getDelta()
        controls.update()

        const store = useFactoryStore.getState()
        for (const entity of store.placedEntities) {
          if (entity.type === "robot") {
            if (!robotMeshesRef.current[entity.id]) {
              const mesh = buildRobotMesh(entity.id)
              mesh.position.set(entity.x, 0.2, entity.z)
              scene.add(mesh)
              robotMeshesRef.current[entity.id] = mesh
              robotPosRef.current[entity.id] = { x: entity.x, y: entity.z }
              // Start patrolling immediately; backend robot_path will override when selected
              if (!robotWaypointsRef.current[entity.id]) {
                const patrol = DEFAULT_PATROLS[entity.id]
                  ?? [[entity.x, entity.z], [entity.x + 4, entity.z], [entity.x + 4, entity.z + 4], [entity.x, entity.z + 4]]
                robotWaypointsRef.current[entity.id] = { waypoints: patrol as [number,number][], index: 0 }
              }
            }
            const mesh = robotMeshesRef.current[entity.id]
            if (!mesh) continue

            const wp = robotWaypointsRef.current[entity.id]
            if (wp && wp.waypoints.length > 0) {
              // When path ends, reset to index 0 and travel back physically (no teleport)
              if (wp.index >= wp.waypoints.length) {
                wp.index = 0
              }
              const [tx, tz] = wp.waypoints[wp.index]
              const ddx = tx - mesh.position.x
              const ddz = tz - mesh.position.z
              const dist = Math.sqrt(ddx * ddx + ddz * ddz)
              const step = ROBOT_SPEED * delta
              if (dist <= step) {
                mesh.position.x = tx
                mesh.position.z = tz
                wp.index++
              } else {
                mesh.position.x += (ddx / dist) * step
                mesh.position.z += (ddz / dist) * step
              }
            } else {
              // No path yet — move toward sensor-reported position
              const target = robotPosRef.current[entity.id]
              if (target) {
                const ddx = target.x - mesh.position.x
                const ddz = target.y - mesh.position.z
                const dist = Math.sqrt(ddx * ddx + ddz * ddz)
                const step = ROBOT_SPEED * delta
                if (dist <= step) {
                  mesh.position.x = target.x
                  mesh.position.z = target.y
                } else {
                  mesh.position.x += (ddx / dist) * step
                  mesh.position.z += (ddz / dist) * step
                }
              }
            }
          } else if (entity.type === "custom") {
            if (!machineGroupsRef.current[entity.id] && !gltfLoadingRef.current.has(entity.id)) {
              if (entity.modelUrl) {
                gltfLoadingRef.current.add(entity.id)
                loadGLTFModel(entity.modelUrl, entity.id).then((group) => {
                  const scale: EntityScale = store.entityScales[entity.id] ?? { x: 1, y: 1, z: 1 }
                  group.scale.set(
                    group.scale.x * scale.x,
                    group.scale.y * scale.y,
                    group.scale.z * scale.z,
                  )
                  group.position.set(entity.x, 0, entity.z)
                  scene.add(group)
                  machineGroupsRef.current[entity.id] = group
                  gltfLoadingRef.current.delete(entity.id)
                }).catch(() => {
                  gltfLoadingRef.current.delete(entity.id)
                })
              }
            }
          } else {
            if (!machineGroupsRef.current[entity.id]) {
              const scale: EntityScale = store.entityScales[entity.id] ?? { x: 1, y: 1, z: 1 }
              const group = buildMachineGroupScaled(entity.id, entity.type as MachineType, scale)
              group.position.set(entity.x, 0, entity.z)
              scene.add(group)
              machineGroupsRef.current[entity.id] = group
            }
          }
        }

        for (const id of Object.keys(machineGroupsRef.current)) {
          if (!store.placedEntities.find((e) => e.id === id)) {
            const group = machineGroupsRef.current[id]
            scene.remove(group)
            // custom GLTF는 고유 geometry/material을 가지므로 명시적 dispose
            // (빌트인 기계는 캐시된 공유 리소스이므로 dispose 금지)
            if (group.userData.entityType === "custom") {
              disposeGLTFModel(group)
            }
            delete machineGroupsRef.current[id]
            gltfLoadingRef.current.delete(id)
          }
        }
        for (const id of Object.keys(robotMeshesRef.current)) {
          if (!store.placedEntities.find((e) => e.id === id)) {
            scene.remove(robotMeshesRef.current[id])
            delete robotMeshesRef.current[id]
          }
        }

        renderer.render(scene, camera)
      }
      animate()

      return () => {
        cancelAnimationFrame(rafId)
        resizeObserver.disconnect()
        canvas.removeEventListener("mousedown", onMouseDown)
        canvas.removeEventListener("mousemove", onMouseMove)
        canvas.removeEventListener("mouseup", onMouseUp)
        canvas.removeEventListener("dblclick", onDblClick)
        canvas.removeEventListener("mouseup", onEditModeClick)
        unsubEditMode()
        unsubScales()
        scene.remove(tcHelper)
        transformControls.dispose()
        controls.dispose()
        disposeScene(scene, renderer)
      }
    }

    // Defer one frame so the wrapper div has been laid out and canvas has real dimensions
    const initRaf = requestAnimationFrame(() => {
      const cleanup = setup()
      // store cleanup for the outer return
      ;(cleanupRef as React.MutableRefObject<(() => void) | null>).current = cleanup ?? null
    })

    const cleanupRef = { current: null as (() => void) | null }

    return () => {
      cancelAnimationFrame(initRaf)
      cleanupRef.current?.()
    }
  }, [canvasRef])

  const updatePathLine = (robotId: string, path: [number, number][]) => {
    const scene = sceneRef.current
    if (!scene) return
    const prev = pathLinesRef.current[robotId]
    if (prev) { scene.remove(prev); prev.geometry.dispose() }
    if (path.length < 2) return
    const line = buildPathLine(path)
    scene.add(line)
    pathLinesRef.current[robotId] = line
  }

  const clearPathLine = (robotId: string) => {
    const scene = sceneRef.current
    if (!scene) return
    const line = pathLinesRef.current[robotId]
    if (line) { scene.remove(line); line.geometry.dispose(); delete pathLinesRef.current[robotId] }
  }

  const updateRobotPath = (robotId: string, waypoints: [number, number][]) => {
    if (!waypoints.length) return
    const existing = robotWaypointsRef.current[robotId]
    // Keep current index if the path hasn't changed — prevents resetting to 0 on each 2Hz update
    if (existing) {
      const a = existing.waypoints
      const same = a.length === waypoints.length &&
        a[0]?.[0] === waypoints[0]?.[0] && a[0]?.[1] === waypoints[0]?.[1] &&
        a[a.length - 1]?.[0] === waypoints[waypoints.length - 1]?.[0] &&
        a[a.length - 1]?.[1] === waypoints[waypoints.length - 1]?.[1]
      if (same) return
    }
    robotWaypointsRef.current[robotId] = { waypoints, index: 0 }
  }

  const updateComponentFault = (machineId: string, faultedParts: Record<string, { severity: "warn" | "critical" }>) => {
    const group = machineGroupsRef.current[machineId]
    if (group) applyComponentFault(group, faultedParts)
  }

  /** 룰 엔진에서 주입받는 메쉬 색상 오버레이 콜백 */
  const applyMeshOverlay = (machineId: string, color: string | null) => {
    const group = machineGroupsRef.current[machineId]
    if (!group) return
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial
        if (color) {
          mat.emissive = new THREE.Color(color)
          mat.emissiveIntensity = 0.7
        } else {
          mat.emissive = new THREE.Color(0x000000)
          mat.emissiveIntensity = 0
        }
      }
    })
  }

  // Sync 3D selection outline when store selectedEntityId changes (e.g. from Palette click)
  useEffect(() => {
    const unsub = useFactoryStore.subscribe((state, prev) => {
      const newId = state.selectedEntityId
      const prevId = prev.selectedEntityId
      if (newId === prevId) return
      if (prevId) {
        const obj = machineGroupsRef.current[prevId] ?? robotMeshesRef.current[prevId]
        if (obj) removeSelectionOutline(obj)
      }
      if (newId) {
        const obj = machineGroupsRef.current[newId] ?? robotMeshesRef.current[newId]
        if (obj) addSelectionOutline(obj)
      }
    })
    return unsub
  }, [])

  return { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateRobotPath, updateComponentFault, applyMeshOverlay }
}
