"use client"
import { useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { AddEntityModal } from "@/components/AddEntityModal"
import type { EntityType } from "@/lib/types"

const TYPE_ICON: Record<string, string> = {
  press: "⬛", cnc: "⚙", conveyor: "▬", robot: "◎",
}

const MACHINE_TYPES: EntityType[] = ["press", "cnc", "conveyor"]
const ROBOT_TYPES: EntityType[] = ["robot"]

export function Palette() {
  const [modalOpen, setModalOpen] = useState(false)

  const placedEntities     = useFactoryStore((s) => s.placedEntities)
  const placementMode      = useFactoryStore((s) => s.placementMode)
  const exitPlacementMode  = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity       = useFactoryStore((s) => s.removeEntity)
  const selectedEntityId   = useFactoryStore((s) => s.selectedEntityId)
  const selectEntity       = useFactoryStore((s) => s.selectEntity)

  const machines = placedEntities.filter((e) => MACHINE_TYPES.includes(e.type))
  const robots   = placedEntities.filter((e) => ROBOT_TYPES.includes(e.type))

  const handleItemClick = (poolId: string) => {
    if (placementMode?.poolId === poolId) { exitPlacementMode(); return }
    selectEntity(selectedEntityId === poolId ? null : poolId)
  }

  const renderItem = (poolId: string, type: EntityType, label: string) => {
    const selected = selectedEntityId === poolId
    const active   = placementMode?.poolId === poolId
    return (
      <div
        key={poolId}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors cursor-pointer
          ${active   ? "bg-yellow-600 text-white"
          : selected ? "bg-blue-700 text-white"
          :            "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}
        onClick={() => handleItemClick(poolId)}
      >
        <span>{TYPE_ICON[type]}</span>
        <span className="flex-1 truncate">{label}</span>
        <button
          onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
          className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <>
      {modalOpen && <AddEntityModal onClose={() => setModalOpen(false)} />}

      <div className="bg-gray-900 rounded-xl p-3 w-44 space-y-3 select-none flex-shrink-0">
        {placementMode && (
          <div className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-2 py-1">
            바닥을 클릭하여 배치
          </div>
        )}

        <button
          onClick={() => setModalOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <span>+</span>
          <span>추가</span>
        </button>

        {machines.length > 0 && (
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">기계</p>
            <div className="space-y-1">
              {machines.map(({ id, type, label }) => renderItem(id, type, label))}
            </div>
          </section>
        )}

        {robots.length > 0 && (
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">로봇</p>
            <div className="space-y-1">
              {robots.map(({ id, type, label }) => renderItem(id, type, label))}
            </div>
          </section>
        )}

        {placedEntities.length === 0 && !placementMode && (
          <p className="text-xs text-gray-600 text-center py-2">
            + 추가로 장비를 배치하세요
          </p>
        )}
      </div>
    </>
  )
}
