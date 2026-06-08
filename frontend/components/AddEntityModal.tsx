"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

const TYPE_META = [
  { type: "press"    as EntityType, icon: "⬛", korLabel: "프레스" },
  { type: "cnc"      as EntityType, icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor" as EntityType, icon: "▬",  korLabel: "컨베이어" },
  { type: "robot"    as EntityType, icon: "◎",  korLabel: "AMR" },
]
const MAX_PER_TYPE = 5

interface Props {
  onClose: () => void
}

export function AddEntityModal({ onClose }: Props) {
  const placedEntities     = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)

  const countOf = (type: EntityType) =>
    placedEntities.filter((e) => e.type === type).length

  const handleSelect = (type: EntityType) => {
    const count = countOf(type)
    if (count >= MAX_PER_TYPE) return

    const n = count + 1
    const meta = TYPE_META.find((m) => m.type === type)!
    const label = `${meta.korLabel} #${n}`
    const poolId = `${type}-${Date.now()}`

    enterPlacementMode(type, poolId, label)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl p-6 w-80 shadow-2xl border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">장비 추가</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {TYPE_META.map(({ type, icon, korLabel }) => {
            const count = countOf(type)
            const disabled = count >= MAX_PER_TYPE
            return (
              <button
                key={type}
                onClick={() => handleSelect(type)}
                disabled={disabled}
                className={`flex flex-col items-center gap-2 rounded-xl p-4 border transition-colors
                  ${disabled
                    ? "border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed"
                    : "border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-500 hover:bg-gray-700 cursor-pointer"
                  }`}
              >
                <span className="text-2xl">{icon}</span>
                <span className="text-sm font-medium">{korLabel}</span>
                <span className={`text-xs ${disabled ? "text-gray-600" : "text-gray-400"}`}>
                  {count} / {MAX_PER_TYPE}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-gray-500 text-xs text-center mt-4">
          카드를 클릭하면 배치 모드로 전환됩니다
        </p>
      </div>
    </div>
  )
}
