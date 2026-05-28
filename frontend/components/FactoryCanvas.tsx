"use client"
import type { RefObject } from "react"

interface Props {
  canvasRef: RefObject<HTMLCanvasElement>
}

export function FactoryCanvas({ canvasRef }: Props) {
  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-lg"
      style={{ height: "500px" }}
    />
  )
}
