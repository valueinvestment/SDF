"use client"
import { useRef, useEffect, type RefObject } from "react"

interface Props {
  canvasRef: RefObject<HTMLCanvasElement>
}

export function FactoryCanvas({ canvasRef }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Keep canvas pixel dimensions in sync with wrapper layout size
  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) return

    const sync = () => {
      const w = wrapper.clientWidth
      const h = wrapper.clientHeight
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
      }
    }

    const ro = new ResizeObserver(sync)
    ro.observe(wrapper)
    sync()
    return () => ro.disconnect()
  }, [canvasRef])

  return (
    <div
      ref={wrapperRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: "clamp(380px, 55vh, 700px)" }}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  )
}
