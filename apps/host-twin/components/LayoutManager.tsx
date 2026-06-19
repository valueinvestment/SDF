"use client"
/**
 * LayoutManager
 *
 * CSS Grid 기반 자유 레이아웃 매니저.
 * - 패널별 grid-column / grid-row를 Zustand layoutConfig에서 읽음
 * - 드래그 앤 드롭으로 패널 순서/위치 교환
 * - 2컬럼 / 3컬럼 전환
 * - 패널 표시/숨김 토글
 * - 모든 상태는 dashboardConfig에 포함되어 URL 직렬화됨
 */

import {
  useState, useRef, useCallback,
  type ReactNode, type DragEvent,
} from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { LayoutPanelId, LayoutPanel } from "@sdf/types"

// ── 그리드 위치 프리셋 ─────────────────────────────────────────────
// columns=3 기준의 프리셋. columns=2 시 col 값을 자동 클램핑
const COL_PRESETS_3 = [
  { label: "1열", col: "1 / 2" },
  { label: "2열", col: "2 / 3" },
  { label: "3열", col: "3 / 4" },
  { label: "1-2열", col: "1 / 3" },
  { label: "2-3열", col: "2 / 4" },
  { label: "전체", col: "1 / 4" },
]

const ROW_PRESETS = [
  { label: "1행", row: "1 / 2" },
  { label: "2행", row: "2 / 3" },
  { label: "3행", row: "3 / 4" },
  { label: "1-2행", row: "1 / 3" },
]

interface PanelWrapperProps {
  panelId: LayoutPanelId
  panel: LayoutPanel
  children: ReactNode
  onDragStart: (id: LayoutPanelId) => void
  onDrop: (targetId: LayoutPanelId) => void
  editingLayout: boolean
}

function PanelWrapper({
  panelId, panel, children, onDragStart, onDrop, editingLayout,
}: PanelWrapperProps) {
  const [over, setOver] = useState(false)
  const updatePanel = useFactoryStore((s) => s.updatePanel)
  const [showPopover, setShowPopover] = useState(false)

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setOver(true) }
  const handleDragLeave = () => setOver(false)
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onDrop(panelId)
  }

  if (!panel.visible) return null

  return (
    <div
      style={{ gridColumn: panel.col, gridRow: panel.row }}
      draggable={editingLayout}
      onDragStart={() => onDragStart(panelId)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative min-h-0 transition-all ${
        over && editingLayout ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-950" : ""
      }`}
    >
      {/* 편집 모드: 패널 상단 드래그 핸들 + 위치 변경 팝오버 */}
      {editingLayout && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-1 bg-gray-900/90 border-b border-blue-800/60 px-2 py-1 rounded-t-lg cursor-grab active:cursor-grabbing">
          <span className="text-[9px] text-blue-400 font-semibold tracking-wider select-none flex-1">
            ⠿ {panel.label}
          </span>
          <button
            onClick={() => setShowPopover((v) => !v)}
            className="text-[9px] text-blue-400 hover:text-blue-300 px-1"
          >
            ⚙
          </button>
          <button
            onClick={() => updatePanel(panelId, { visible: false })}
            className="text-[9px] text-gray-500 hover:text-red-400 px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* 위치 변경 팝오버 */}
      {editingLayout && showPopover && (
        <div className="absolute top-7 right-0 z-30 bg-gray-800 border border-blue-800/60 rounded-lg p-2 shadow-xl w-52">
          <p className="text-[9px] text-gray-500 mb-1">컬럼</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {COL_PRESETS_3.map((p) => (
              <button
                key={p.col}
                onClick={() => { updatePanel(panelId, { col: p.col }); setShowPopover(false) }}
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  panel.col === p.col ? "border-blue-500 text-blue-300 bg-blue-900/30" : "border-gray-600 text-gray-400 hover:border-gray-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-gray-500 mb-1">행</p>
          <div className="flex flex-wrap gap-1">
            {ROW_PRESETS.map((p) => (
              <button
                key={p.row}
                onClick={() => { updatePanel(panelId, { row: p.row }); setShowPopover(false) }}
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  panel.row === p.row ? "border-blue-500 text-blue-300 bg-blue-900/30" : "border-gray-600 text-gray-400 hover:border-gray-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={editingLayout ? "pt-6" : ""}>
        {children}
      </div>
    </div>
  )
}

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
            {([2, 3] as const).map((c) => (
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
interface LayoutGridProps {
  editingLayout: boolean
  panels: Record<LayoutPanelId, ReactNode>
}

export function LayoutGrid({ editingLayout, panels }: LayoutGridProps) {
  const layoutConfig = useFactoryStore((s) => s.layoutConfig)
  const updatePanel = useFactoryStore((s) => s.updatePanel)
  const dragSourceRef = useRef<LayoutPanelId | null>(null)

  const handleDragStart = useCallback((id: LayoutPanelId) => {
    dragSourceRef.current = id
  }, [])

  const handleDrop = useCallback((targetId: LayoutPanelId) => {
    const srcId = dragSourceRef.current
    if (!srcId || srcId === targetId) return
    const src = layoutConfig.panels.find((p) => p.id === srcId)
    const tgt = layoutConfig.panels.find((p) => p.id === targetId)
    if (!src || !tgt) return
    // col/row를 교환 (위치 스왑)
    updatePanel(srcId, { col: tgt.col, row: tgt.row })
    updatePanel(targetId, { col: src.col, row: src.row })
    dragSourceRef.current = null
  }, [layoutConfig.panels, updatePanel])

  const cols = layoutConfig.columns

  return (
    <div
      className="grid gap-3 mt-3"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: "auto",
      }}
    >
      {layoutConfig.panels.map((panel) => (
        <PanelWrapper
          key={panel.id}
          panelId={panel.id}
          panel={panel}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          editingLayout={editingLayout}
        >
          {panels[panel.id]}
        </PanelWrapper>
      ))}
    </div>
  )
}
