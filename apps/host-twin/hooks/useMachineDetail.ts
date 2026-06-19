import { useFactoryStore } from "@/store/factoryStore"
import type { MachineDetail } from "@sdf/types"

export interface CriticalPart {
  part: string
  description: string
}

export function useMachineDetail(machineId: string): {
  detail: MachineDetail | undefined
  criticalParts: CriticalPart[]
} {
  const detail = useFactoryStore((s) => s.machineDetails[machineId])
  const fault = useFactoryStore((s) => s.componentFaults[machineId])

  const criticalParts: CriticalPart[] = fault
    ? Object.entries(fault.faultedParts)
        .filter(([, v]) => v.severity === "critical")
        .map(([part, v]) => ({ part, description: v.description }))
    : []

  return { detail, criticalParts }
}
