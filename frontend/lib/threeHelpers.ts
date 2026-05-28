import * as THREE from "three"

const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material>()

function getGeo(key: string, factory: () => THREE.BufferGeometry) {
  if (!geoCache.has(key)) geoCache.set(key, factory())
  return geoCache.get(key)!
}

function getMat(key: string, factory: () => THREE.Material) {
  if (!matCache.has(key)) matCache.set(key, factory())
  return matCache.get(key)!
}

export function buildMachineMesh(id: string): THREE.Mesh {
  const geo = getGeo("machine", () => new THREE.BoxGeometry(1.2, 1.2, 1.2))
  const mat = getMat("machine_normal", () =>
    new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = id
  return mesh
}

export function buildRobotMesh(id: string): THREE.Mesh {
  const geo = getGeo("robot", () => new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8))
  const mat = getMat("robot", () =>
    new THREE.MeshStandardMaterial({ color: 0x10b981 })
  )
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = id
  return mesh
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
  renderer.forceContextLoss()
}
