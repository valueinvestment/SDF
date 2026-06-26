import { describe, it, expect, beforeEach } from "vitest"
import {
  URL_SAFE_LENGTH,
  LOCAL_STORAGE_KEY,
  validateCompressedLength,
  decideSyncStrategy,
  saveToLocalStorage,
  loadFromLocalStorage,
} from "@/lib/configSerialization"

describe("validateCompressedLength", () => {
  it("marks short strings as safe", () => {
    const result = validateCompressedLength("abc")
    expect(result.safe).toBe(true)
    expect(result.length).toBe(3)
    expect(result.limit).toBe(URL_SAFE_LENGTH)
  })

  it("marks strings exactly at the limit as safe (inclusive boundary)", () => {
    const atLimit = "x".repeat(URL_SAFE_LENGTH)
    expect(validateCompressedLength(atLimit).safe).toBe(true)
  })

  it("marks strings one over the limit as unsafe", () => {
    const overLimit = "x".repeat(URL_SAFE_LENGTH + 1)
    expect(validateCompressedLength(overLimit).safe).toBe(false)
  })

  it("respects a custom limit", () => {
    expect(validateCompressedLength("xxxxx", 4).safe).toBe(false)
    expect(validateCompressedLength("xxx", 4).safe).toBe(true)
  })
})

describe("decideSyncStrategy", () => {
  it("returns url mode when within limit", () => {
    const strategy = decideSyncStrategy("compressed-payload")
    expect(strategy.mode).toBe("url")
    if (strategy.mode === "url") {
      expect(strategy.compressed).toBe("compressed-payload")
    }
  })

  it("returns localStorage mode when over limit", () => {
    const huge = "x".repeat(URL_SAFE_LENGTH + 500)
    const strategy = decideSyncStrategy(huge)
    expect(strategy.mode).toBe("localStorage")
    if (strategy.mode === "localStorage") {
      expect(strategy.length).toBe(URL_SAFE_LENGTH + 500)
      expect(strategy.limit).toBe(URL_SAFE_LENGTH)
    }
  })
})

describe("localStorage fallback round-trip", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("saves and loads config JSON", () => {
    const json = JSON.stringify({ hello: "world" })
    expect(saveToLocalStorage(json)).toBe(true)
    expect(loadFromLocalStorage()).toBe(json)
    expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBe(json)
  })

  it("returns null when nothing is stored", () => {
    expect(loadFromLocalStorage()).toBeNull()
  })
})
