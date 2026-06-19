import { useFactoryStore } from "@/store/factoryStore"
import type { RobotPathDetail } from "@sdf/types"

export function useRobotDetail(robotId: string): {
  path: RobotPathDetail | undefined
  isDispatched: boolean
} {
  const path = useFactoryStore((s) => s.robotPaths[robotId])
  const dispatch = useFactoryStore((s) => s.dispatchCommand)
  const isDispatched = dispatch?.robotId === robotId
  return { path, isDispatched }
}
