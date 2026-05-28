"use client"
import { useRef } from "react"
import { useThreeScene } from "@/hooks/useThreeScene"

export function FactoryCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useThreeScene(canvasRef)

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: "500px" }}
    />
  )
}
