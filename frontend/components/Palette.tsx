"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

const POOL_MACHINES = [
  { poolId: "M1", type: "press" as EntityType, label: "프레스" },
  { poolId: "M2", type: "cnc" as EntityType, label: "CNC" },
  { poolId: "M3", type: "cnc" as EntityType, label: "CNC #2" },
  { poolId: "M4", type: "conveyor" as EntityType, label: "컨베이어" },
  { poolId: "M5", type: "press" as EntityType, label: "프레스 #2" },
]
const POOL_ROBOTS = [
  { poolId: "R1", type: "robot" as EntityType, label: "AMR #1" },
  { poolId: "R2", type: "robot" as EntityType, label: "AMR #2" },
  { poolId: "R3", type: "robot" as EntityType, label: "AMR #3" },
]

const TYPE_ICON: Record<string, string> = {
  press: "⬛", cnc: "⚙", conveyor: "▬", robot: "◎",
}

export function Palette() {
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const placementMode = useFactoryStore((s) => s.placementMode)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)
  const exitPlacementMode = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity = useFactoryStore((s) => s.removeEntity)

  const isPlaced = (poolId: string) => placedEntities.some((e) => e.id === poolId)

  const handleItemClick = (poolId: string, type: EntityType) => {
    if (isPlaced(poolId)) return
    if (placementMode?.poolId === poolId) { exitPlacementMode(); return }
    enterPlacementMode(type, poolId)
  }

  const renderItem = (poolId: string, type: EntityType, label: string) => {
    const placed = isPlaced(poolId)
    const active = placementMode?.poolId === poolId
    return (
      <div
        key={poolId}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
          ${placed ? "opacity-30 cursor-not-allowed text-gray-500"
            : active ? "bg-yellow-600 text-white cursor-pointer"
            : "hover:bg-gray-700 text-gray-200 cursor-pointer"}`}
        onClick={() => handleItemClick(poolId, type)}
      >
        <span>{TYPE_ICON[type]}</span>
        <span className="flex-1">{label}</span>
        {placed && (
          <button
            onClick={(e) => { e.stopPropagation(); removeEntity(poolId) }}
            className="text-gray-500 hover:text-red-400 text-xs"
          >✕</button>
        )}
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-xl p-3 w-44 space-y-3 select-none flex-shrink-0">
      {placementMode && (
        <div className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-2 py-1">
          바닥을 클릭하여 배치
        </div>
      )}

      <section>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">기계</p>
        <div className="space-y-1">
          {POOL_MACHINES.map(({ poolId, type, label }) => renderItem(poolId, type, label))}
        </div>
      </section>

      <section>
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">로봇</p>
        <div className="space-y-1">
          {POOL_ROBOTS.map(({ poolId, type, label }) => renderItem(poolId, type, label))}
        </div>
      </section>
    </div>
  )
}
