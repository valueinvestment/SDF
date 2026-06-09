import { useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { EntityType, PlacedEntity } from "@/lib/types"

const MACHINE_TYPES: EntityType[] = ["press", "cnc", "conveyor"]
const ROBOT_TYPES: EntityType[] = ["robot"]

export const TYPE_ICON: Record<string, string> = {
  press: "⬛",
  cnc: "⚙",
  conveyor: "▬",
  robot: "◎",
}

export function usePalette() {
  const [modalOpen, setModalOpen] = useState(false)

  const placedEntities    = useFactoryStore((s) => s.placedEntities)
  const placementMode     = useFactoryStore((s) => s.placementMode)
  const exitPlacementMode = useFactoryStore((s) => s.exitPlacementMode)
  const removeEntity      = useFactoryStore((s) => s.removeEntity)
  const selectedEntityId  = useFactoryStore((s) => s.selectedEntityId)
  const selectEntity      = useFactoryStore((s) => s.selectEntity)

  const machines: PlacedEntity[] = placedEntities.filter((e) =>
    MACHINE_TYPES.includes(e.type)
  )
  const robots: PlacedEntity[] = placedEntities.filter((e) =>
    ROBOT_TYPES.includes(e.type)
  )

  const handleItemClick = (poolId: string) => {
    if (placementMode?.poolId === poolId) {
      exitPlacementMode()
      return
    }
    selectEntity(selectedEntityId === poolId ? null : poolId)
  }

  return {
    modalOpen,
    setModalOpen,
    machines,
    robots,
    placedEntities,
    placementMode,
    selectedEntityId,
    removeEntity,
    handleItemClick,
  }
}
