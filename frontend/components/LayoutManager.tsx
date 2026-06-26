"use client"

import {
  useCallback, useMemo,
  type ReactNode,
} from "react"
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout"
import type { Layout, LayoutItem } from "react-grid-layout"
import type { RefObject } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { LayoutPanelId } from "@/lib/types"

import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"

// ── 레이아웃 컨트롤바 ──────────────────────────────────────────────
interface LayoutControlBarProps {
  editingLayout: boolean
  onToggle: () => void
}

export function LayoutControlBar({ editingLayout, onToggle }: LayoutControlBarProps) {
  const layoutConfig = useFactoryStore((s) => s.layoutConfig)
  const setLayoutColumns = useFactoryStore((s) => s.setLayoutColumns)
  const updatePanel = useFactoryStore((s) => s.updatePanel)

  const hiddenPanels = layoutConfig.panels.filter((p) => !p.visible)

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-lg border transition-all ${
      editingLayout ? "border-blue-600/60 bg-blue-950/20" : "border-gray-800 bg-transparent"
    }`}>
      <button
        onClick={onToggle}
        className={`text-xs px-2.5 py-1 rounded border font-medium transition-all ${
          editingLayout
            ? "border-blue-500 text-blue-300 bg-blue-900/30"
            : "border-gray-700 text-gray-400 hover:border-gray-600"
        }`}
      >
        {editingLayout ? "레이아웃 편집 중..." : "레이아웃"}
      </button>

      {editingLayout && (
        <>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">컬럼</span>
            {([2, 3, 4] as const).map((c) => (
              <button
                key={c}
                onClick={() => setLayoutColumns(c)}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  layoutConfig.columns === c
                    ? "border-blue-500 text-blue-300 bg-blue-900/30"
                    : "border-gray-700 text-gray-400"
                }`}
              >
                {c}열
              </button>
            ))}
          </div>

          {hiddenPanels.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">숨긴 패널:</span>
              {hiddenPanels.map((p) => (
                <button
                  key={p.id}
                  onClick={() => updatePanel(p.id, { visible: true })}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 hover:border-blue-600 hover:text-blue-400"
                >
                  {p.label} +
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 메인 레이아웃 그리드 래퍼 ─────────────────────────────────────
// react-grid-layout v2: WidthProvider HOC 대신 useContainerWidth 훅 사용
// (ResizeObserver 기반 — 프로젝트의 기존 반응형 패턴과 일관)
interface LayoutGridProps {
  editingLayout: boolean
  panels: Record<LayoutPanelId, ReactNode>
}

const ROW_HEIGHT = 80
const BREAKPOINTS = { lg: 1024, md: 768, sm: 480 } as const

export function LayoutGrid({ editingLayout, panels }: LayoutGridProps) {
  const layoutConfig = useFactoryStore((s) => s.layoutConfig)
  const setLayoutConfig = useFactoryStore((s) => s.setLayoutConfig)
  const updatePanel = useFactoryStore((s) => s.updatePanel)

  const { width, mounted, containerRef } = useContainerWidth()

  const visiblePanels = useMemo(
    () => layoutConfig.panels.filter((p) => p.visible),
    [layoutConfig.panels],
  )

  const layout: LayoutItem[] = useMemo(
    () => visiblePanels.map((p) => ({
      i: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      minW: 1,
      minH: 1,
      static: !editingLayout,
    })),
    [visiblePanels, editingLayout],
  )

  const handleLayoutChange = useCallback((next: Layout) => {
    if (!editingLayout) return
    const current = useFactoryStore.getState().layoutConfig
    const updatedPanels = current.panels.map((panel) => {
      const item = next.find((l) => l.i === panel.id)
      if (!item) return panel
      return { ...panel, x: item.x, y: item.y, w: item.w, h: item.h }
    })
    setLayoutConfig({ ...current, panels: updatedPanels })
  }, [editingLayout, setLayoutConfig])

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} className="w-full">
      {mounted && (
        <Responsive
          className="layout"
          width={width}
          layouts={{ lg: layout }}
          breakpoints={BREAKPOINTS}
          cols={{ lg: layoutConfig.columns, md: 2, sm: 1 }}
          rowHeight={ROW_HEIGHT}
          dragConfig={{ enabled: editingLayout, handle: ".rgl-drag-handle" }}
          resizeConfig={{ enabled: editingLayout }}
          onLayoutChange={handleLayoutChange}
          compactor={verticalCompactor}
          margin={[12, 12]}
        >
          {visiblePanels.map((panel) => (
            <div
              key={panel.id}
              className={`relative ${
                editingLayout
                  ? "rounded-lg border-2 border-dashed border-blue-500/60 bg-blue-500/[0.04] shadow-[0_0_0_1px_rgba(59,130,246,0.15)]"
                  : ""
              }`}
            >
              {/* 편집 모드: 드래그 핸들 + 숨김 버튼 */}
              {editingLayout && (
                <div className="rgl-drag-handle absolute top-0 left-0 right-0 z-20 flex items-center gap-1 bg-gray-900/90 border-b border-blue-800/60 px-2 py-1 rounded-t-lg cursor-grab active:cursor-grabbing">
                  <span className="text-[9px] text-blue-400 font-semibold tracking-wider select-none flex-1">
                    &#x2807; {panel.label}
                  </span>
                  <span
                    className="text-[9px] font-mono text-blue-300/90 bg-blue-950/60 border border-blue-800/50 px-1 rounded select-none"
                    title={`가로 ${panel.w}칸 × 세로 ${panel.h}행`}
                  >
                    {panel.w}×{panel.h}
                  </span>
                  <button
                    onClick={() => updatePanel(panel.id, { visible: false })}
                    className="text-[9px] text-gray-500 hover:text-red-400 px-1"
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className={`h-full overflow-auto ${editingLayout ? "pt-6" : ""}`}>
                {panels[panel.id]}
              </div>
            </div>
          ))}
        </Responsive>
      )}
    </div>
  )
}
