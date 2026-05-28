"use client"
import { useEffect, useRef } from "react"
import * as THREE from "three"
import {
  buildMachineMesh, buildRobotMesh,
  MACHINE_POSITIONS, ROBOT_START_POSITIONS,
  disposeScene,
} from "@/lib/threeHelpers"

export interface RobotPositionRef {
  [robotId: string]: { x: number; y: number }
}

export function useThreeScene(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const robotPosRef = useRef<RobotPositionRef>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)

    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000)
    camera.position.set(8, 18, 18)
    camera.lookAt(8, 0, 8)

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(10, 20, 10)
    scene.add(dir)

    const grid = new THREE.GridHelper(20, 20, 0x374151, 0x1f2937)
    grid.position.set(10, 0, 10)
    scene.add(grid)

    for (const [id, [x, z]] of Object.entries(MACHINE_POSITIONS)) {
      const mesh = buildMachineMesh(id)
      mesh.position.set(x, 0.6, z)
      scene.add(mesh)
    }

    const robotMeshes: Record<string, THREE.Mesh> = {}
    for (const [id, [x, z]] of Object.entries(ROBOT_START_POSITIONS)) {
      const mesh = buildRobotMesh(id)
      mesh.position.set(x, 0.2, z)
      scene.add(mesh)
      robotMeshes[id] = mesh
      robotPosRef.current[id] = { x, y: z }
    }

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      for (const [id, mesh] of Object.entries(robotMeshes)) {
        const target = robotPosRef.current[id]
        if (target) {
          mesh.position.x += (target.x - mesh.position.x) * 0.08
          mesh.position.z += (target.y - mesh.position.z) * 0.08
        }
      }
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      disposeScene(scene, renderer)
    }
  }, [canvasRef])

  return robotPosRef
}
