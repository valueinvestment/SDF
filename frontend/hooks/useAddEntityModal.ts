import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType } from "@/lib/types"

export const TYPE_META = [
  { type: "press"    as EntityType, icon: "⬛", korLabel: "프레스" },
  { type: "cnc"      as EntityType, icon: "⚙",  korLabel: "CNC" },
  { type: "conveyor" as EntityType, icon: "▬",  korLabel: "컨베이어" },
  { type: "robot"    as EntityType, icon: "◎",  korLabel: "AMR" },
] as const

export const MAX_PER_TYPE = 5

export function useAddEntityModal() {
  const placedEntities     = useFactoryStore((s) => s.placedEntities)
  const enterPlacementMode = useFactoryStore((s) => s.enterPlacementMode)

  const countOf = (type: EntityType): number =>
    placedEntities.filter((e) => e.type === type).length

  const canAdd = (type: EntityType): boolean =>
    countOf(type) < MAX_PER_TYPE

  const select = (type: EntityType, onClose: () => void): void => {
    if (!canAdd(type)) return
    const count = countOf(type)
    const meta = TYPE_META.find((m) => m.type === type)!
    const label = `${meta.korLabel} #${count + 1}`
    const poolId = `${type}-${Date.now()}`
    enterPlacementMode(type, poolId, label)
    onClose()
  }

  return { typeMeta: TYPE_META, countOf, canAdd, select }
}
