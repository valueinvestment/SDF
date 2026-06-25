import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType, EntityScale } from "@/lib/types"

export const TYPE_META = [
  { type: "press"    as EntityType, icon: "⬛", korLabel: "프레스" },
  { type: "cnc"      as EntityType, icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor" as EntityType, icon: "▬",  korLabel: "컨베이어" },
  { type: "robot"    as EntityType, icon: "◎",  korLabel: "AMR" },
  { type: "custom"   as EntityType, icon: "📦", korLabel: "3D 모델" },
] as const

export const MAX_PER_TYPE = 5

export function useAddEntityModal() {
  const placedEntities     = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)
  const setEntityScale     = useFactoryStore((s) => s.setEntityScale)

  const countOf = (type: EntityType): number =>
    placedEntities.filter((e) => e.type === type).length

  const canAdd = (type: EntityType): boolean =>
    countOf(type) < MAX_PER_TYPE

  const select = (type: EntityType, scale: EntityScale, onClose: () => void, modelUrl?: string): void => {
    if (type !== "custom" && !canAdd(type)) return
    const count = countOf(type)
    const meta = TYPE_META.find((m) => m.type === type)
    const label = type === "custom"
      ? `Custom #${count + 1}`
      : `${meta!.korLabel} #${count + 1}`
    const poolId = `${type}-${Date.now()}`
    if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
      setEntityScale(poolId, scale)
    }
    enterPlacementMode(type, poolId, label, modelUrl)
    onClose()
  }

  return { typeMeta: TYPE_META, countOf, canAdd, select }
}
