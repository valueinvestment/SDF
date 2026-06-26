"use client"
import { useRef, useEffect, type RefObject } from "react"
import { useFactoryStore } from "@/store/factoryStore"

interface Props {
  canvasRef: RefObject<HTMLCanvasElement>
}

const SNAP_OPTIONS = [0.25, 0.5, 1.0, 2.0]

export function FactoryCanvas({ canvasRef }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const editMode = useFactoryStore((s) => s.editMode)
  const toggleEditMode = useFactoryStore((s) => s.toggleEditMode)
  const snapUnit = useFactoryStore((s) => s.snapUnit)
  const setSnapUnit = useFactoryStore((s) => s.setSnapUnit)

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
    <div className="relative h-full">
      {/* 저작 모드 컨트롤바 */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        {editMode && (
          <div className="flex items-center gap-1 bg-gray-900/90 border border-amber-700/60 rounded-lg px-2 py-1">
            <span className="text-[10px] text-amber-400 font-mono">스냅</span>
            {SNAP_OPTIONS.map((u) => (
              <button
                key={u}
                onClick={() => setSnapUnit(u)}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                  snapUnit === u
                    ? "bg-amber-600 text-white"
                    : "text-amber-500 hover:bg-amber-900/50"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={toggleEditMode}
          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
            editMode
              ? "bg-amber-600/30 border-amber-500 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
              : "bg-gray-800/80 border-gray-600 text-gray-400 hover:border-gray-500"
          }`}
        >
          {editMode ? "✏ 편집 모드 ON" : "편집 모드"}
        </button>
      </div>

      {/* 편집 모드 힌트 오버레이 */}
      {editMode && (
        <div className="absolute bottom-2 left-2 z-10 bg-gray-900/80 border border-amber-700/40 rounded-lg px-2 py-1">
          <p className="text-[10px] text-amber-400/80">
            클릭: 기즈모 선택 · 드래그: X/Z 이동 · 스냅: {snapUnit} 단위
          </p>
        </div>
      )}

      <div
        ref={wrapperRef}
        className={`w-full h-full rounded-lg overflow-hidden transition-all ${
          editMode ? "ring-2 ring-amber-500/50" : ""
        }`}
        style={{ minHeight: "240px" }}
      >
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>
    </div>
  )
}
