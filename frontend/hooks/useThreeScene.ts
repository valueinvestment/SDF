"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import {
  buildMachineGroup, buildRobotMesh, buildPathLine,
  addSelectionOutline, removeSelectionOutline, applyComponentFault,
  disposeScene, MACHINE_POSITIONS, ROBOT_START_POSITIONS,
} from "@/lib/threeHelpers"
import { useFactoryStore } from "@/store/factoryStore"
import type { MachineType, PlacedEntity } from "@/lib/types"

export interface RobotPositionRef {
  [robotId: string]: { x: number; y: number }
}
export interface MachineGroupRef {
  [machineId: string]: THREE.Group
}
export interface RobotMeshRef {
  [robotId: string]: THREE.Mesh
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})
  const machineGroupsRef = useRef<MachineGroupRef>({})
  const robotMeshesRef = useRef<RobotMeshRef>({})
  const pathLinesRef = useRef<Record<string, THREE.Line>>({})
  const ghostRef = useRef<THREE.Group | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(10, 20, 20)
    camera.lookAt(10, 0, 10)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    const grid = new THREE.GridHelper(22, 22, 0x374151, 0x1f2937)
    grid.position.set(10, 0, 10)
    scene.add(grid)

    // Invisible floor plane for raycasting
    const floorGeo = new THREE.PlaneGeometry(22, 22)
    const floorMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(10, 0, 10)
    floor.name = "__floor__"
    scene.add(floor)

    const raycaster = new THREE.Raycaster()

    const onMouseMove = (e: MouseEvent) => {
      const store = useFactoryStore.getState()
      if (!store.placementMode) {
        if (ghostRef.current) {
          scene.remove(ghostRef.current)
          ghostRef.current = null
        }
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
          ? (() => { const g = new THREE.Group(); return g })()
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
        if (obj instanceof THREE.Mesh) {
          (obj.material as THREE.MeshStandardMaterial).color.setHex(
            tooClose ? 0xef4444 : 0x3b82f6
          )
        }
      })
    }

    const onClick = (e: MouseEvent) => {
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
          const dx = en.x - x, dz = en.z - z
          return Math.sqrt(dx * dx + dz * dz) < 1.5
        })
        if (tooClose) return

        store.placeEntity(store.placementMode.poolId, store.placementMode.type, x, z)
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

      if (!hits.length) {
        store.selectEntity(null)
        return
      }

      let obj: THREE.Object3D | null = hits[0].object
      while (obj && !obj.userData.entityId) obj = obj.parent ?? null
      if (!obj?.userData.entityId) return

      const entityId = obj.userData.entityId as string
      store.selectEntity(entityId)
      addSelectionOutline(obj)
    }

    canvas.addEventListener("mousemove", onMouseMove)
    canvas.addEventListener("click", onClick)

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)

      const store = useFactoryStore.getState()
      for (const entity of store.placedEntities) {
        if (entity.type === "robot") {
          if (!robotMeshesRef.current[entity.id]) {
            const mesh = buildRobotMesh(entity.id)
            mesh.position.set(entity.x, 0.2, entity.z)
            scene.add(mesh)
            robotMeshesRef.current[entity.id] = mesh
            robotPosRef.current[entity.id] = { x: entity.x, y: entity.z }
          }
          const target = robotPosRef.current[entity.id]
          const mesh = robotMeshesRef.current[entity.id]
          if (target && mesh) {
            mesh.position.x += (target.x - mesh.position.x) * 0.08
            mesh.position.z += (target.y - mesh.position.z) * 0.08
          }
        } else {
          if (!machineGroupsRef.current[entity.id]) {
            const group = buildMachineGroup(entity.id, entity.type as MachineType)
            group.position.set(entity.x, 0, entity.z)
            scene.add(group)
            machineGroupsRef.current[entity.id] = group
          }
        }
      }

      for (const id of Object.keys(machineGroupsRef.current)) {
        if (!store.placedEntities.find((e) => e.id === id)) {
          scene.remove(machineGroupsRef.current[id])
          delete machineGroupsRef.current[id]
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
      canvas.removeEventListener("mousemove", onMouseMove)
      canvas.removeEventListener("click", onClick)
      disposeScene(scene, renderer)
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

  const updateComponentFault = (machineId: string, faultedParts: Record<string, { severity: "warn" | "critical" }>) => {
    const group = machineGroupsRef.current[machineId]
    if (group) applyComponentFault(group, faultedParts)
  }

  return { robotPosRef, machineGroupsRef, updatePathLine, clearPathLine, updateComponentFault }
}
