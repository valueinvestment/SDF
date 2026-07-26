import { describe, it, expect } from "vitest"
import { encode, decode } from "../sdfRecording"

function makeMachines(entries: Record<string, [number, number, number, number][]>) {
  const machines: Record<string, { history: [number, number, number, number][] }> = {}
  for (const [id, history] of Object.entries(entries)) {
    machines[id] = { history }
  }
  return machines
}

describe("sdfRecording — round trip", () => {
  it("round-trips a single machine with two samples", () => {
    const machines = makeMachines({
      M1: [
        [1700000000000, 50.5, 60.1, 10.2],
        [1700000000100, 51.2, 60.3, 10.1],
      ],
    })
    const decoded = decode(encode(machines))

    expect(decoded.channels).toEqual(["vibration", "temperature", "current"])
    expect(decoded.sessionStartTs).toBe(1700000000000)
    expect(decoded.machines).toHaveLength(1)
    expect(decoded.machines[0].id).toBe("M1")
    expect(decoded.machines[0].samples).toHaveLength(2)
    expect(decoded.machines[0].samples[0].tsOffsetMs).toBe(0)
    expect(decoded.machines[0].samples[0].values[0]).toBeCloseTo(50.5, 4)
    expect(decoded.machines[0].samples[0].values[1]).toBeCloseTo(60.1, 4)
    expect(decoded.machines[0].samples[0].values[2]).toBeCloseTo(10.2, 4)
    expect(decoded.machines[0].samples[1].tsOffsetMs).toBe(100)
    expect(decoded.machines[0].samples[1].values[0]).toBeCloseTo(51.2, 4)
  })

  it("round-trips multiple machines with different sample counts", () => {
    const machines = makeMachines({
      M1: [[1000, 1, 2, 3]],
      M2: [
        [900, 4, 5, 6],
        [1000, 7, 8, 9],
        [1100, 10, 11, 12],
      ],
    })
    const decoded = decode(encode(machines))

    expect(decoded.machines).toHaveLength(2)
    expect(decoded.sessionStartTs).toBe(900) // earliest timestamp across all machines
    const m1 = decoded.machines.find((m) => m.id === "M1")!
    const m2 = decoded.machines.find((m) => m.id === "M2")!
    expect(m1.samples).toHaveLength(1)
    expect(m1.samples[0].tsOffsetMs).toBe(100) // 1000 - 900
    expect(m2.samples).toHaveLength(3)
    expect(m2.samples[0].tsOffsetMs).toBe(0) // 900 - 900
  })

  it("round-trips an empty machines object to a header-only file", () => {
    const decoded = decode(encode({}))
    expect(decoded.channels).toEqual(["vibration", "temperature", "current"])
    expect(decoded.machines).toEqual([])
  })
})

describe("sdfRecording — validation", () => {
  it("decode() throws when the magic bytes don't match", () => {
    const bad = new ArrayBuffer(4)
    new Uint8Array(bad).set([0x00, 0x01, 0x02, 0x03])
    expect(() => decode(bad)).toThrow(/not a valid \.sdfrec file/)
  })

  it("decode() throws on an unsupported version", () => {
    const buffer = encode(makeMachines({ M1: [[1000, 1, 2, 3]] }))
    const view = new DataView(buffer)
    view.setUint8(4, 99) // version byte is at offset 4
    expect(() => decode(buffer)).toThrow(/unsupported version/)
  })

  it("encode() throws when a machine id exceeds 255 bytes", () => {
    const longId = "M".repeat(256)
    expect(() => encode(makeMachines({ [longId]: [[1000, 1, 2, 3]] }))).toThrow(/exceeds 255 bytes/)
  })
})
