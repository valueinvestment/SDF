/**
 * simulator — Pure frontend sensor data simulator.
 *
 * Sine-wave base + Gaussian noise synthesis.
 * Framework-agnostic: no React dependency.
 */

import type { SensorSnapshot, SimParamsForSensor, MachineStatus } from "@sdf/types"

/** Box-Muller transform: standard normal random */
export function gaussianRandom(): number {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

/** Sine wave + Gaussian noise synthesis */
export function sineWithNoise(
  phase: number,
  params: SimParamsForSensor,
  noiseFactor: number,
): number {
  const amplitude = (params.max - params.min) / 2
  const sineValue = params.avg + amplitude * Math.sin(phase)
  const noise = gaussianRandom() * amplitude * noiseFactor * 0.3
  return Math.max(params.min, Math.min(params.max, sineValue + noise))
}

/** Per-machine sine wave phase offset (each machine oscillates at a different phase) */
const PHASE_OFFSETS: Record<string, number> = {}
export function getPhaseOffset(id: string): number {
  if (PHASE_OFFSETS[id] === undefined) {
    PHASE_OFFSETS[id] = Math.random() * Math.PI * 2
  }
  return PHASE_OFFSETS[id]
}

export interface SimulatorTickResult {
  snapshot: SensorSnapshot
  faultedMachines: string[]
}

export interface SimulatorConfig {
  baseTickMs: number
  sinePeriodSec: number
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  baseTickMs: 500,
  sinePeriodSec: 30,
}

export function computeMachineStatus(faultTimer: number): MachineStatus {
  if (faultTimer <= 0) return "fault"
  if (faultTimer <= 10) return "degraded"
  return "normal"
}
