import { describe, it, expect } from "vitest"
import { PluginPanelConflictError } from "../errors"

describe("PluginPanelConflictError", () => {
  it("is an Error subclass carrying the given message", () => {
    const err = new PluginPanelConflictError("panel id already registered: demo")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PluginPanelConflictError)
    expect(err.message).toBe("panel id already registered: demo")
  })
})
