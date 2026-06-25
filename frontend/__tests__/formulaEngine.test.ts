import { describe, it, expect } from "vitest"
import {
  evaluateFormula,
  evaluateCondition,
  validateFormula,
} from "@/lib/formulaEngine"

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
