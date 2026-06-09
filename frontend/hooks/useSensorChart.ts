import { useFactoryStore } from "@/store/factoryStore"

export function useSensorChart(machineId: string) {
  const history = useFactoryStore((s) => s.machines[machineId]?.history)
  return { history }
}
