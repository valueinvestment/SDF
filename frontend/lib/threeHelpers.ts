import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import type { MachineType, EntityScale } from "@/lib/types"

const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material>()

function getGeo(key: string, factory: () => THREE.BufferGeometry) {
  if (!geoCache.has(key)) geoCache.set(key, factory())
  return geoCache.get(key)!
}

export function getMat(key: string, factory: () => THREE.Material) {
  if (!matCache.has(key)) matCache.set(key, factory())
  return matCache.get(key)!
}

export const MACHINE_POSITIONS: Record<string, [number, number]> = {
  M1: [3, 3], M2: [7, 3], M3: [12, 3], M4: [3, 12], M5: [12, 12],
}

export const ROBOT_START_POSITIONS: Record<string, [number, number]> = {
  R1: [10, 10], R2: [5, 5], R3: [15, 5],
}

export function disposeScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
  renderer.dispose()
}

export const STATUS_COLORS: Record<string, number> = {
  normal: 0x3b82f6,
  degraded: 0xf59e0b,
  fault: 0xef4444,
}

export function getMachineMaterial(status: string): THREE.MeshStandardMaterial {
  const key = `machine_${status}`
  return getMat(key, () =>
    new THREE.MeshStandardMaterial({ color: STATUS_COLORS[status] ?? 0x6b7280 })
  ) as THREE.MeshStandardMaterial
}

// Sub-mesh definitions for each machine type
interface SubMeshDef {
  name: string
  geo: () => THREE.BufferGeometry
  position: [number, number, number]
}

const MACHINE_SUBMESH_DEFS: Record<MachineType, SubMeshDef[]> = {
  press: [
    { name: "body",        geo: () => new THREE.BoxGeometry(1.4, 0.6, 1.4),         position: [0, 0.3, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8), position: [0, 1.0, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(0.6, 0.5, 0.6),         position: [0, 1.6, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.15, 8, 8),         position: [0.6, 1.1, 0.6] },
  ],
  cnc: [
    { name: "body",        geo: () => new THREE.BoxGeometry(1.2, 1.2, 1.2),          position: [0, 0.6, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.18, 0.18, 1.0, 8), position: [-0.7, 0.8, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(0.4, 0.6, 0.4),          position: [0, 1.5, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.15, 8, 8),          position: [0.5, 1.3, 0.5] },
  ],
  conveyor: [
    { name: "body",        geo: () => new THREE.BoxGeometry(2.4, 0.3, 0.8),         position: [0, 0.15, 0] },
    { name: "motor",       geo: () => new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), position: [1.1, 0.4, 0] },
    { name: "actuator",    geo: () => new THREE.BoxGeometry(2.2, 0.1, 0.6),         position: [0, 0.35, 0] },
    { name: "sensor_unit", geo: () => new THREE.SphereGeometry(0.12, 8, 8),         position: [0, 0.5, 0.4] },
  ],
}

export function buildMachineGroup(poolId: string, type: MachineType): THREE.Group {
  const group = new THREE.Group()
  group.userData.entityId = poolId
  group.userData.entityType = "machine"

  const baseMat = getMat("machine_part_base", () =>
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  ) as THREE.MeshStandardMaterial

  for (const def of MACHINE_SUBMESH_DEFS[type]) {
    const mesh = new THREE.Mesh(def.geo(), baseMat.clone())
    mesh.name = def.name
    mesh.userData.partName = def.name
    mesh.position.set(...def.position)
    group.add(mesh)
  }
  return group
}

/** 스케일 팩터 적용 버전 — AddEntityModal의 슬라이더 값 전달 시 사용 */
export function buildMachineGroupScaled(
  poolId: string,
  type: MachineType,
  scale: EntityScale,
): THREE.Group {
  const group = buildMachineGroup(poolId, type)
  group.scale.set(scale.x, scale.y, scale.z)
  group.userData.entityScale = scale
  return group
}

export function buildRobotMesh(poolId: string): THREE.Mesh {
  const geo = getGeo("robot", () => new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8))
  const mat = getMat("robot", () =>
    new THREE.MeshStandardMaterial({ color: 0x10b981 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.entityId = poolId
  mesh.userData.entityType = "robot"
  return mesh
}

export function addSelectionOutline(target: THREE.Object3D): void {
  removeSelectionOutline(target)
  const mat = getMat("selection_outline", () =>
    new THREE.LineBasicMaterial({ color: 0xfbbf24 })
  ) as THREE.LineBasicMaterial

  target.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const edges = new THREE.EdgesGeometry(obj.geometry)
      const outline = new THREE.LineSegments(edges, mat)
      outline.name = "__sel_outline__"
      obj.add(outline)
    }
  })
}

export function removeSelectionOutline(target: THREE.Object3D): void {
  const toRemove: { parent: THREE.Object3D; child: THREE.Object3D }[] = []
  target.traverse((obj) => {
    if (obj.name === "__sel_outline__" && obj.parent) {
      toRemove.push({ parent: obj.parent, child: obj })
    }
  })
  for (const { parent, child } of toRemove) {
    parent.remove(child)
  }
}

export function buildPathLine(path: [number, number][]): THREE.Line {
  const points = path.map(([x, z]) => new THREE.Vector3(x, 0.15, z))
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = getMat("path_line", () =>
    new THREE.LineDashedMaterial({ color: 0x10b981, dashSize: 0.4, gapSize: 0.2 })
  ) as THREE.LineDashedMaterial
  const line = new THREE.Line(geo, mat)
  line.computeLineDistances()
  line.name = "__path__"
  return line
}

// ── GLTF 동적 로딩 ──────────────────────────────────────────────────
const gltfLoader = new GLTFLoader()
const gltfCache = new Map<string, THREE.Group>()

export async function loadGLTFModel(
  url: string,
  entityId: string,
): Promise<THREE.Group> {
  const cached = gltfCache.get(url)
  if (cached) {
    const clone = cached.clone()
    clone.userData.entityId = entityId
    clone.userData.entityType = "custom"
    return clone
  }

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        const model = gltf.scene
        model.userData.entityId = entityId
        model.userData.entityType = "custom"
        // 바운딩 박스로 자동 스케일링 (최대 2 유닛에 맞춤)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        if (maxDim > 0) {
          const scale = 2 / maxDim
          model.scale.multiplyScalar(scale)
        }
        // 바닥면 정렬
        const reBox = new THREE.Box3().setFromObject(model)
        model.position.y = -reBox.min.y
        gltfCache.set(url, model.clone())
        resolve(model)
      },
      undefined,
      (error) => reject(error),
    )
  })
}

/** 브라우저에서 File 객체를 ObjectURL로 변환 후 GLTF 로드 */
export async function loadGLTFFromFile(
  file: File,
  entityId: string,
): Promise<{ group: THREE.Group; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const group = await loadGLTFModel(objectUrl, entityId)
    return { group, objectUrl }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

/** 씬에서 custom GLTF 메쉬를 제거하고 ObjectURL 정리 */
export function disposeGLTFModel(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}

export function applyComponentFault(
  group: THREE.Group,
  faultedParts: Record<string, { severity: "warn" | "critical" }>
): void {
  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.userData.partName) return
    const mat = obj.material as THREE.MeshStandardMaterial
    const fault = faultedParts[obj.userData.partName]
    if (fault) {
      mat.color.setHex(fault.severity === "critical" ? 0xef4444 : 0xf59e0b)
      mat.emissive.setHex(fault.severity === "critical" ? 0x7f1d1d : 0x78350f)
    } else {
      mat.color.setHex(0x3b82f6)
      mat.emissive.setHex(0x000000)
    }
  })
}
