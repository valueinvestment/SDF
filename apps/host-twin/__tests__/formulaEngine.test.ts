import { describe, it, expect } from "vitest"
import {
  evaluateFormula,
  evaluateCondition,
  validateFormula,
  listAvailableVariables,
} from "@sdf/core-sdk"
import { BASE_RULE_VARIABLES } from "@sdf/types"
import type { ComputedMetric } from "@sdf/types"

const SENSORS = { vibration: 50, temperature: 120, current: 15 }

describe("evaluateFormula", () => {
  it("evaluates arithmetic with precedence", () => {
    const r = evaluateFormula("(vibration + temperature) / 2", SENSORS)
    expect(r.ok && r.value).toBe(85)
  })

  it("supports built-in functions", () => {
    expect(evaluateFormula("max(vibration, temperature)", SENSORS)).toEqual({ ok: true, value: 120 })
    expect(evaluateFormula("sqrt(current * current)", SENSORS)).toEqual({ ok: true, value: 15 })
  })

  it("returns error on division by zero", () => {
    const r = evaluateFormula("temperature / 0", SENSORS)
    expect(r.ok).toBe(false)
  })

  it("returns error on unknown variable", () => {
    const r = evaluateFormula("pressure + 1", SENSORS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Unknown variable/)
  })

  it("returns error on malformed syntax", () => {
    expect(evaluateFormula("vibration +", SENSORS).ok).toBe(false)
    expect(evaluateFormula("@@@", SENSORS).ok).toBe(false)
  })
})

describe("evaluateCondition — rule engine thresholds", () => {
  it("triggers when threshold exceeded", () => {
    expect(evaluateCondition("temperature > 100", SENSORS)).toBe(true)
  })

  it("does not trigger when within threshold", () => {
    expect(evaluateCondition("temperature > 200", SENSORS)).toBe(false)
  })

  it("supports compound computed-metric conditions", () => {
    const vars = { ...SENSORS, custom: 200 }
    expect(evaluateCondition("custom >= 200", vars)).toBe(true)
  })

  it("returns false (does not throw) on broken condition during live typing", () => {
    expect(evaluateCondition("temperature >", SENSORS)).toBe(false)
  })
})

describe("validateFormula", () => {
  it("accepts valid formulas", () => {
    expect(validateFormula("vibration * 1.2").valid).toBe(true)
  })

  it("rejects invalid formulas with an error message", () => {
    const r = validateFormula("nonsense(")
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe("validateFormula — extraVariableNames", () => {
  it("rejects a computed-metric name when not passed as an extra variable (pre-existing bug, locked in as current behavior)", () => {
    const r = validateFormula("heat_index > 50")
    expect(r.valid).toBe(false)
  })

  it("accepts a computed-metric name when passed via extraVariableNames", () => {
    const r = validateFormula("heat_index > 50", ["heat_index"])
    expect(r.valid).toBe(true)
  })

  it("still validates base variables without any extraVariableNames", () => {
    expect(validateFormula("temperature > 100").valid).toBe(true)
  })
})

describe("listAvailableVariables", () => {
  const metrics: ComputedMetric[] = [
    { id: "heat_index", name: "열지수", formula: "(vibration+temperature)/2", color: "#fff", machineId: null },
    { id: "m1_only", name: "M1 전용", formula: "current * 2", color: "#fff", machineId: "M1" },
    { id: "m2_only", name: "M2 전용", formula: "current * 3", color: "#fff", machineId: "M2" },
  ]

  it("always includes the base variables", () => {
    const result = listAvailableVariables(null, [])
    expect(result).toEqual([...BASE_RULE_VARIABLES])
  })

  it("includes global (machineId: null) computed metrics regardless of scope", () => {
    const result = listAvailableVariables("M1", metrics)
    expect(result).toContain("heat_index")
  })

  it("includes only the computed metrics scoped to the given machine, not other machines'", () => {
    const result = listAvailableVariables("M1", metrics)
    expect(result).toContain("m1_only")
    expect(result).not.toContain("m2_only")
  })

  it("includes only global computed metrics when machineId is null", () => {
    const result = listAvailableVariables(null, metrics)
    expect(result).toContain("heat_index")
    expect(result).not.toContain("m1_only")
    expect(result).not.toContain("m2_only")
  })
})
