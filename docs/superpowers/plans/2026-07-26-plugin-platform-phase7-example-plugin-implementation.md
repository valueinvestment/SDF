# Phase 7 — Example Plugin (.sdfrec Session Recorder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a third example plugin that stress-tests every prior plugin contract end-to-end: it downloads the live store's sensor history as a `.sdfrec` binary file, and separately accepts an uploaded `.sdfrec` file, parses it off the main thread in a Web Worker, and visualizes it — using only the existing `PluginProps.useStoreSlice` whitelist API, no new host bindings.

**Architecture:** `apps/host-twin/lib/sdfRecording.ts` implements `encode()`/`decode()` as pure functions matching `docs/sdfrec-format-spec.md` exactly. A thin Web Worker (`sdfRecordingParser.worker.ts`) wraps `decode()` for off-main-thread parsing — mirroring Phase 6's "thin untested glue + thickly tested pure function" pattern. The plugin component (`sessionRecorderPlugin.tsx`) owns the download button, the drag-drop upload zone (modeled on `AddEntityModal`'s pattern), and the Worker lifecycle.

**Tech Stack:** TypeScript, React 18, Web Workers (native `postMessage`, no library), Vitest + Testing Library, ECharts (via existing `BaseECharts`).

**Design specs:** `docs/superpowers/specs/2026-07-26-plugin-platform-phase7-example-plugin-design.md` (full rationale, including why real MDF4 parsing and a long-duration recording feature were both explicitly ruled out of scope) and `docs/sdfrec-format-spec.md` (the binary format's authoritative spec — read this before Task 1, since Task 1 is a direct transcription of it).

---

## File Structure

- `apps/host-twin/lib/sdfRecording.ts` (new) — `encode(machines)` / `decode(buffer)` pure functions. The only place format knowledge lives on the read/write side.
- `apps/host-twin/lib/__tests__/sdfRecording.test.ts` (new) — round-trip and validation tests for the above.
- `apps/host-twin/workers/sdfRecordingParser.worker.ts` (new) — thin Worker wrapper around `decode()`. No dedicated test (see Task 2's rationale).
- `apps/host-twin/plugins/sessionRecorderPlugin.tsx` (new) — the plugin: download button + upload/parse/visualize flow.
- `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx` (new) — component tests with a mocked `Worker` global and mocked `BaseECharts`.
- `apps/host-twin/lib/plugins.ts` (modify) — register the new plugin.
- `scripts/generate-sample-sdfrec.mjs` (new) — one-off generator producing the committed example fixture. Plain Node ESM (no TS build step), matching the existing `scripts/create-plugin.mjs` convention.
- `examples/sdfrec/sample-session.sdfrec` (new, committed binary) — output of the script above; a multi-machine, multi-thousand-sample file for the "Web Worker actually matters" demo.
- `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md` (modify) — mark Phase 7 complete, add a backlog entry for the deferred long-duration recording feature.

---

### Task 1: `.sdfrec` encode/decode pure functions

**Files:**
- Create: `apps/host-twin/lib/sdfRecording.ts`
- Test: `apps/host-twin/lib/__tests__/sdfRecording.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/lib/__tests__/sdfRecording.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- sdfRecording.test.ts`
Expected: FAIL — `Cannot find module '../sdfRecording'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/host-twin/lib/sdfRecording.ts`. This is a direct transcription of `docs/sdfrec-format-spec.md` — read that document alongside this code if anything is unclear.

```ts
const MAGIC = "SDFR"
const VERSION = 1
const CHANNEL_NAMES = ["vibration", "temperature", "current"] as const

export interface SdfRecordingMachines {
  [machineId: string]: { history: [number, number, number, number][] }
}

export interface DecodedSample {
  tsOffsetMs: number
  values: number[]
}

export interface DecodedMachine {
  id: string
  samples: DecodedSample[]
}

export interface DecodedRecording {
  sessionStartTs: number
  channels: string[]
  machines: DecodedMachine[]
}

function assertByteLength(text: string, label: string): Uint8Array {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length > 255) {
    throw new Error(`sdfRecording: ${label} "${text}" exceeds 255 bytes when UTF-8 encoded`)
  }
  return bytes
}

export function encode(machines: SdfRecordingMachines): ArrayBuffer {
  const machineIds = Object.keys(machines)
  const channelNameBytes = CHANNEL_NAMES.map((name) => assertByteLength(name, "channel name"))
  const machineIdBytes = machineIds.map((id) => assertByteLength(id, "machine id"))

  const firstTimestamps = machineIds
    .map((id) => machines[id].history[0]?.[0])
    .filter((ts): ts is number => ts !== undefined)
  const sessionStartTs = firstTimestamps.length > 0 ? Math.min(...firstTimestamps) : Date.now()

  let headerSize = 4 + 1 + 8 + 1 // magic + version + sessionStartTs + channelCount
  for (const bytes of channelNameBytes) headerSize += 1 + bytes.length
  headerSize += 2 // machineCount
  for (const bytes of machineIdBytes) headerSize += 1 + bytes.length + 4

  const sampleSize = 4 + 4 * CHANNEL_NAMES.length
  let dataSize = 0
  for (const id of machineIds) dataSize += machines[id].history.length * sampleSize

  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  bytes.set(new TextEncoder().encode(MAGIC), offset)
  offset += 4
  view.setUint8(offset, VERSION)
  offset += 1
  view.setFloat64(offset, sessionStartTs, true)
  offset += 8
  view.setUint8(offset, CHANNEL_NAMES.length)
  offset += 1
  for (const nameBytes of channelNameBytes) {
    view.setUint8(offset, nameBytes.length)
    offset += 1
    bytes.set(nameBytes, offset)
    offset += nameBytes.length
  }
  view.setUint16(offset, machineIds.length, true)
  offset += 2
  for (let i = 0; i < machineIds.length; i++) {
    const idBytes = machineIdBytes[i]
    view.setUint8(offset, idBytes.length)
    offset += 1
    bytes.set(idBytes, offset)
    offset += idBytes.length
    view.setUint32(offset, machines[machineIds[i]].history.length, true)
    offset += 4
  }

  for (const id of machineIds) {
    for (const row of machines[id].history) {
      const [ts, vibration, temperature, current] = row
      view.setUint32(offset, ts - sessionStartTs, true)
      offset += 4
      view.setFloat32(offset, vibration, true)
      offset += 4
      view.setFloat32(offset, temperature, true)
      offset += 4
      view.setFloat32(offset, current, true)
      offset += 4
    }
  }

  return buffer
}

export function decode(buffer: ArrayBuffer): DecodedRecording {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  const magic = new TextDecoder().decode(bytes.subarray(0, 4))
  if (magic !== MAGIC) {
    throw new Error(`sdfRecording: not a valid .sdfrec file (expected magic "SDFR", got "${magic}")`)
  }
  offset += 4

  const version = view.getUint8(offset)
  offset += 1
  if (version !== VERSION) {
    throw new Error(`sdfRecording: unsupported version ${version} (expected ${VERSION})`)
  }

  const sessionStartTs = view.getFloat64(offset, true)
  offset += 8

  const channelCount = view.getUint8(offset)
  offset += 1
  const channels: string[] = []
  for (let i = 0; i < channelCount; i++) {
    const nameLength = view.getUint8(offset)
    offset += 1
    channels.push(new TextDecoder().decode(bytes.subarray(offset, offset + nameLength)))
    offset += nameLength
  }

  const machineCount = view.getUint16(offset, true)
  offset += 2
  const machineMeta: { id: string; sampleCount: number }[] = []
  for (let i = 0; i < machineCount; i++) {
    const idLength = view.getUint8(offset)
    offset += 1
    const id = new TextDecoder().decode(bytes.subarray(offset, offset + idLength))
    offset += idLength
    const sampleCount = view.getUint32(offset, true)
    offset += 4
    machineMeta.push({ id, sampleCount })
  }

  const machines: DecodedMachine[] = []
  for (const { id, sampleCount } of machineMeta) {
    const samples: DecodedSample[] = []
    for (let i = 0; i < sampleCount; i++) {
      const tsOffsetMs = view.getUint32(offset, true)
      offset += 4
      const values: number[] = []
      for (let c = 0; c < channelCount; c++) {
        values.push(view.getFloat32(offset, true))
        offset += 4
      }
      samples.push({ tsOffsetMs, values })
    }
    machines.push({ id, samples })
  }

  return { sessionStartTs, channels, machines }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- sdfRecording.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run the full host-twin test suite and typecheck**

Run: `pnpm --filter @sdf/host-twin test && pnpm --filter @sdf/host-twin typecheck`
Expected: PASS, no errors

- [ ] **Step 6: Commit**

```bash
git add apps/host-twin/lib/sdfRecording.ts apps/host-twin/lib/__tests__/sdfRecording.test.ts
git commit -m "feat(host-twin): implement .sdfrec encode/decode per format spec"
```

---

### Task 2: Web Worker wrapper

**Files:**
- Create: `apps/host-twin/workers/sdfRecordingParser.worker.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/host-twin/workers/sdfRecordingParser.worker.ts`:

```ts
/// <reference lib="webworker" />
import { decode } from "@/lib/sdfRecording"

export interface WorkerResponse {
  ok: boolean
  data?: ReturnType<typeof decode>
  error?: string
}

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const data = decode(e.data)
    const response: WorkerResponse = { ok: true, data }
    ;(self as unknown as Worker).postMessage(response)
  } catch (err) {
    const response: WorkerResponse = { ok: false, error: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(response)
  }
}
```

The `/// <reference lib="webworker" />` triple-slash directive at the top gives this ONE file the Worker-scope global types (`self`, `onmessage`, `postMessage` with the worker-side single-argument signature) without changing the project's shared `tsconfig.json` `lib` array — the project uses `"dom"` (for `Window`/`document`/etc. everywhere else), and TypeScript does not support having both `"dom"` and `"webworker"` active globally in one program, since they declare incompatible versions of some global names. This directive is the standard, narrowly-scoped way to type an individual Worker file inside a DOM-lib project.

**No dedicated test for this file.** Its only job is to call the already-thoroughly-tested `decode()` and forward the result — matching Phase 6's established convention that thin message-passing glue (`simulation_loop`, `useWebSocket.ts`) isn't unit-tested directly; the real logic underneath already is.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @sdf/host-twin typecheck`
Expected: no errors. If this specific file produces an error related to `self`/`postMessage`/`onmessage` typing despite the reference directive, STOP and report the exact error rather than working around it with `any` — this would mean the directive isn't taking effect as expected in this project's TS/bundler configuration and needs a different fix (e.g. widening the cast on `self`), not a blanket type-safety bypass.

- [ ] **Step 3: Commit**

```bash
git add apps/host-twin/workers/sdfRecordingParser.worker.ts
git commit -m "feat(host-twin): add thin Web Worker wrapper for .sdfrec parsing"
```

---

### Task 3: `sessionRecorderPlugin.tsx` — the example plugin

**Files:**
- Create: `apps/host-twin/plugins/sessionRecorderPlugin.tsx`
- Test: `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`
- Modify: `apps/host-twin/lib/plugins.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { encode, decode } from "../../lib/sdfRecording"
import { SessionRecorderPanel } from "../sessionRecorderPlugin"

vi.mock("@/components/BaseECharts", () => ({
  BaseECharts: () => <div data-testid="chart-mock" />,
}))

function makeFakeBindings(machines: unknown) {
  const state = { machines }
  return {
    getReadOnlyState: () => state,
    subscribe: () => () => {},
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
  }
}

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage(buffer: ArrayBuffer) {
    queueMicrotask(() => {
      // Mirrors the real worker's decode-and-respond contract without
      // spinning up an actual thread — see Task 2 for why the real
      // worker file itself has no dedicated test. `decode` is imported
      // at the top of this file (module-level, not require()'d here —
      // this test file is ESM, and a bare require() would throw).
      try {
        const data = decode(buffer)
        this.onmessage?.({ data: { ok: true, data } } as MessageEvent)
      } catch (err) {
        this.onmessage?.({
          data: { ok: false, error: err instanceof Error ? err.message : String(err) },
        } as MessageEvent)
      }
    })
  }
  terminate() {}
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("SessionRecorderPanel", () => {
  it("triggers a download when the download button is clicked", () => {
    const machines = { M1: { history: [[1000, 50, 60, 10]] } }
    const props = createPluginProps(makeFakeBindings(machines))
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => "blob:fake-url")
    URL.revokeObjectURL = vi.fn()

    render(<SessionRecorderPanel {...props} />)
    fireEvent.click(screen.getByText("현재 세션 다운로드"))

    // No need to mock createElement/click — jsdom's real <a> element
    // handles a blob: href and a no-op .click() safely. Asserting on
    // URL.createObjectURL/revokeObjectURL is enough to prove encode()
    // ran and produced a real Blob, which is the behavior that matters.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(blobArg).toBeInstanceOf(Blob)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url")

    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it("shows a loading state, then a chart, after a valid file is uploaded", async () => {
    const props = createPluginProps(makeFakeBindings({}))
    render(<SessionRecorderPanel {...props} />)

    const buffer = encode({ M1: { history: [[1000, 50, 60, 10], [1100, 51, 61, 11]] } })
    const file = new File([buffer], "test.sdfrec")
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    expect(screen.getByText("파싱 중...")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByTestId("chart-mock")).toBeInTheDocument()
    })
    expect(screen.queryByText("파싱 중...")).not.toBeInTheDocument()
  })

  it("shows an error message when an invalid file is uploaded", async () => {
    const props = createPluginProps(makeFakeBindings({}))
    render(<SessionRecorderPanel {...props} />)

    const badBuffer = new ArrayBuffer(4)
    new Uint8Array(badBuffer).set([0, 1, 2, 3])
    const file = new File([badBuffer], "bad.sdfrec")
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/not a valid \.sdfrec file/)).toBeInTheDocument()
    })
  })

  it("shows a machine selector and switches charts when a file has multiple machines", async () => {
    const props = createPluginProps(makeFakeBindings({}))
    render(<SessionRecorderPanel {...props} />)

    const buffer = encode({
      M1: { history: [[1000, 50, 60, 10]] },
      M2: { history: [[1000, 55, 65, 15]] },
    })
    const file = new File([buffer], "multi.sdfrec")
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByTestId("chart-mock")).toBeInTheDocument()
    })
    expect(screen.getByRole("combobox")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "M1" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "M2" })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sdf/host-twin test -- sessionRecorderPlugin.test.tsx`
Expected: FAIL — `Cannot find module '../sessionRecorderPlugin'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/host-twin/plugins/sessionRecorderPlugin.tsx`:

```tsx
"use client"
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import type { PluginProps, SDFPlugin } from "@sdf/types"
import type * as echarts from "echarts"
import { BaseECharts } from "@/components/BaseECharts"
import { encode, type DecodedRecording } from "@/lib/sdfRecording"
import type { WorkerResponse } from "@/workers/sdfRecordingParser.worker"

interface FactoryStoreShape {
  machines: Record<string, { history: [number, number, number, number][] }>
}

export function SessionRecorderPanel(props: PluginProps) {
  const machines = props.useStoreSlice((s) => (s as FactoryStoreShape).machines)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState<DecodedRecording | null>(null)
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDownload = useCallback(() => {
    const buffer = encode(machines)
    const blob = new Blob([buffer], { type: "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `session-${Date.now()}.sdfrec`
    a.click()
    URL.revokeObjectURL(url)
  }, [machines])

  const parseFile = useCallback((file: File) => {
    setLoading(true)
    setError(null)
    setRecording(null)
    file.arrayBuffer().then((buffer) => {
      const worker = new Worker(new URL("../workers/sdfRecordingParser.worker.ts", import.meta.url))
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        setLoading(false)
        if (e.data.ok && e.data.data) {
          setRecording(e.data.data)
          setSelectedMachineId(e.data.data.machines[0]?.id ?? null)
        } else {
          setError(e.data.error ?? "파싱 실패")
        }
        worker.terminate()
      }
      worker.postMessage(buffer, [buffer])
    })
  }, [])

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  const selectedMachine = recording?.machines.find((m) => m.id === selectedMachineId)

  const option: echarts.EChartsOption | null =
    recording && selectedMachine
      ? {
          backgroundColor: "transparent",
          animation: false,
          grid: { left: 36, right: 10, top: 18, bottom: 18 },
          xAxis: { type: "value", axisLabel: { fontSize: 9, color: "#6b7280" } },
          yAxis: { type: "value", axisLabel: { fontSize: 9, color: "#6b7280" } },
          series: recording.channels.map((name, i) => ({
            name,
            type: "line",
            data: selectedMachine.samples.map((s) => [s.tsOffsetMs, s.values[i]]),
            smooth: true,
            symbol: "none",
          })),
        }
      : null

  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-3">
      <p className="text-xs text-gray-400">예시 플러그인: 세션 레코더 (.sdfrec)</p>

      <button
        onClick={handleDownload}
        className="w-full py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium"
      >
        현재 세션 다운로드
      </button>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
          dragOver ? "border-emerald-400 bg-emerald-900/20" : "border-gray-600 hover:border-gray-500"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".sdfrec"
          onChange={handleFileSelect}
          className="hidden"
        />
        <p className="text-xs text-gray-400">.sdfrec 파일을 드래그하거나 클릭하여 업로드</p>
      </div>

      {loading && <p className="text-xs text-gray-500 text-center">파싱 중...</p>}
      {error && <p className="text-xs text-red-400 text-center">{error}</p>}

      {recording && (
        <div className="space-y-2">
          {recording.machines.length > 1 && (
            <select
              value={selectedMachineId ?? ""}
              onChange={(e) => setSelectedMachineId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-white px-2 py-1"
            >
              {recording.machines.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          )}
          {option && <BaseECharts option={option} notMerge={true} />}
        </div>
      )}
    </div>
  )
}

export const sessionRecorderPlugin: SDFPlugin = {
  id: "example-session-recorder",
  name: "Example: Session Recorder",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "example-session-recorder-panel",
      label: "예시: 세션 레코더",
      component: (props) => <SessionRecorderPanel {...props} />,
    })
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sdf/host-twin test -- sessionRecorderPlugin.test.tsx`
Expected: PASS (4 tests). If the first test's DOM mocking needs simplifying per the note in Step 1, adjust it there and re-run.

- [ ] **Step 5: Register the plugin**

Modify `apps/host-twin/lib/plugins.ts` to:

```ts
import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"
import { sessionRecorderPlugin } from "@/plugins/sessionRecorderPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin, sessionRecorderPlugin]
```

- [ ] **Step 6: Run the full host-twin test suite and typecheck**

Run: `pnpm --filter @sdf/host-twin test && pnpm --filter @sdf/host-twin typecheck`
Expected: PASS, no errors

- [ ] **Step 7: Commit**

```bash
git add apps/host-twin/plugins/sessionRecorderPlugin.tsx apps/host-twin/plugins/__tests__/sessionRecorderPlugin.test.tsx apps/host-twin/lib/plugins.ts
git commit -m "feat(host-twin): add session recorder example plugin"
```

---

### Task 4: Sample generator script + committed example fixture

**Files:**
- Create: `scripts/generate-sample-sdfrec.mjs`
- Create (generated, then committed): `examples/sdfrec/sample-session.sdfrec`

- [ ] **Step 1: Write the generator script**

Create `scripts/generate-sample-sdfrec.mjs`. This is a plain Node ESM script (no TypeScript, no build step) — it re-implements the same byte layout as `apps/host-twin/lib/sdfRecording.ts`'s `encode()`, since Node can't directly `import` a `.ts` file without a loader, and this project's `scripts/` convention (established by `scripts/create-plugin.mjs` in Phase 3a) is plain dependency-free Node ESM:

```js
#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs"

const MAGIC = "SDFR"
const VERSION = 1
const CHANNEL_NAMES = ["vibration", "temperature", "current"]
const MACHINE_COUNT = 5
const SAMPLES_PER_MACHINE = 5000

function generateMachineHistory(seed) {
  const history = []
  let ts = Date.now()
  for (let i = 0; i < SAMPLES_PER_MACHINE; i++) {
    history.push([
      ts,
      50 + Math.sin(i / 20 + seed) * 10,
      60 + Math.cos(i / 15 + seed) * 5,
      10 + Math.sin(i / 10 + seed) * 2,
    ])
    ts += 100
  }
  return history
}

function encode(machines) {
  const machineIds = Object.keys(machines)
  const textEncoder = new TextEncoder()
  const channelNameBytes = CHANNEL_NAMES.map((name) => textEncoder.encode(name))
  const machineIdBytes = machineIds.map((id) => textEncoder.encode(id))

  const firstTimestamps = machineIds.map((id) => machines[id][0]?.[0]).filter((ts) => ts !== undefined)
  const sessionStartTs = firstTimestamps.length > 0 ? Math.min(...firstTimestamps) : Date.now()

  let headerSize = 4 + 1 + 8 + 1
  for (const bytes of channelNameBytes) headerSize += 1 + bytes.length
  headerSize += 2
  for (const bytes of machineIdBytes) headerSize += 1 + bytes.length + 4

  const sampleSize = 4 + 4 * CHANNEL_NAMES.length
  let dataSize = 0
  for (const id of machineIds) dataSize += machines[id].length * sampleSize

  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  bytes.set(textEncoder.encode(MAGIC), offset); offset += 4
  view.setUint8(offset, VERSION); offset += 1
  view.setFloat64(offset, sessionStartTs, true); offset += 8
  view.setUint8(offset, CHANNEL_NAMES.length); offset += 1
  for (const nameBytes of channelNameBytes) {
    view.setUint8(offset, nameBytes.length); offset += 1
    bytes.set(nameBytes, offset); offset += nameBytes.length
  }
  view.setUint16(offset, machineIds.length, true); offset += 2
  for (let i = 0; i < machineIds.length; i++) {
    const idBytes = machineIdBytes[i]
    view.setUint8(offset, idBytes.length); offset += 1
    bytes.set(idBytes, offset); offset += idBytes.length
    view.setUint32(offset, machines[machineIds[i]].length, true); offset += 4
  }

  for (const id of machineIds) {
    for (const row of machines[id]) {
      const [ts, vibration, temperature, current] = row
      view.setUint32(offset, ts - sessionStartTs, true); offset += 4
      view.setFloat32(offset, vibration, true); offset += 4
      view.setFloat32(offset, temperature, true); offset += 4
      view.setFloat32(offset, current, true); offset += 4
    }
  }

  return buffer
}

const machines = {}
for (let i = 1; i <= MACHINE_COUNT; i++) {
  machines[`M${i}`] = generateMachineHistory(i)
}

const buffer = encode(machines)
const outDir = "examples/sdfrec"
mkdirSync(outDir, { recursive: true })
const outPath = `${outDir}/sample-session.sdfrec`
writeFileSync(outPath, Buffer.from(buffer))
console.log(`Wrote ${outPath} (${buffer.byteLength} bytes, ${MACHINE_COUNT} machines x ${SAMPLES_PER_MACHINE} samples)`)
```

- [ ] **Step 2: Run the script from the repo root**

Run: `node scripts/generate-sample-sdfrec.mjs`
Expected: prints `Wrote examples/sdfrec/sample-session.sdfrec (400033 bytes, 5 machines x 5000 samples)` (exact byte count may differ slightly depending on machine ID lengths — `M1`-`M5` are 2 bytes each, so this number should be very close to `33 (header for 5 single-char-digit ids) + 5 × 5000 × 16 = 400,033` — if it differs by more than a few bytes, double check the header size math before proceeding) and creates the file.

- [ ] **Step 3: Verify the generated file actually decodes correctly**

This is a quick manual smoke check, not a formal test file (the script itself has no dedicated test — see design doc §6) — but do verify it, since a corrupt example fixture committed to the repo would be a real, silent problem for anyone who tries the demo. Run this from the repo root (plain Node, no TS loader needed — it only reads raw bytes):

```bash
node -e "
const fs = require('fs');
const buf = fs.readFileSync('examples/sdfrec/sample-session.sdfrec');
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const magic = buf.subarray(0, 4).toString('ascii');
console.log('magic:', magic, '| version:', view.getUint8(4), '| file size:', buf.length);
"
```

Expected output: `magic: SDFR | version: 1 | file size: <matches Step 2's reported byte count>`. This confirms the file is well-formed.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-sample-sdfrec.mjs examples/sdfrec/sample-session.sdfrec
git commit -m "feat: add .sdfrec sample generator and committed example fixture"
```

---

### Task 5: Update the roadmap doc

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`

- [ ] **Step 1: Mark Phase 7 complete**

In `docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`, find the Phase 7 section (search for "Phase 7") and update its status, following the same phrasing pattern used for Phase 6's completion note (구현 완료, PR 미생성, referencing this plan's design spec, the format spec, and this implementation plan file). Also update the top status line and the dependency diagram near the bottom, same as prior phases' completion updates.

- [ ] **Step 2: Add the deferred long-duration recording backlog entry**

Add a new `## 백로그 —` section (matching the existing four backlog sections' format), following this content:

```markdown
## 백로그 — 장시간 세션 녹화 기능

**목표:** Phase 7(예시 플러그인) 브레인스토밍 중 논의되었으나 이번 스코프에서 제외됨. 화면용 `HISTORY_MAX`(300개) 캡과 별개로, 사용자가 "녹화 시작"을 누르면 그 이후 샘플을 캡 없이 별도 버퍼에 누적하다가 "녹화 종료" 시 `.sdfrec`로 다운로드하는 기능.

**제외 이유:** 이 앱은 실시간 모니터링에 초점이 맞춰져 있고, 장시간 원본 데이터 녹화는 사후 분석(오프라인 데이터 분석) 목적의 별개 기능이다. 구현하려면 새 스토어 상태(녹화 중 여부, 누적 버퍼)와 시작/종료 UI 컨트롤이 필요해 스코프가 커진다.

**착수 조건:** 실제로 장시간 세션 분석이 필요한 구체적 요구가 생기면 착수.

**의존관계:** Phase 7 완료 후 언제든 독립적으로 착수 가능.

---
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md
git commit -m "docs: mark Phase 7 complete in roadmap, add long-duration recording backlog entry"
```

---

### Task 6: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck every workspace package**

Run: `pnpm typecheck`
Expected: no errors in any of the 5 frontend packages.

- [ ] **Step 2: Run every workspace test suite**

Run: `pnpm test`
Expected: all suites pass — `@sdf/host-twin` gains new passing tests from Tasks 1 and 3; `@sdf/plugin-runtime` and the backend are unaffected by this plan (no files in either were touched) and should show the same counts as before this plan started.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: clean build. This is also the real test of whether `new Worker(new URL("../workers/sdfRecordingParser.worker.ts", import.meta.url))` is recognized correctly by Next.js's webpack 5 build — if this step fails specifically on the worker import, report the exact build error rather than working around it (e.g. by inlining the worker as a Blob URL string), since that would indicate this bundler/version combination needs different Worker-loading configuration than assumed in this plan.

- [ ] **Step 4: Manual confirmation that the example fixture works in the real app**

Since there's no headless browser tooling available in this dev environment (per prior phases' disclosed limitation), confirm statically: after the build in Step 3, grep the built client bundle for the string `"example-session-recorder"` to confirm the plugin's code is actually included:

```bash
grep -rl "example-session-recorder" apps/host-twin/.next/static/chunks/ 2>/dev/null || echo "not found — investigate before proceeding"
```

If this can't find it (e.g. due to minification renaming/inlining), that's an acceptable open item to note rather than a hard failure — same precedent as Phase 2's disclosed static-verification gap for its own manual smoke check.

- [ ] **Step 5: Commit**

No code changes in this task — nothing to commit. If Steps 1-4 all pass clean, this task is complete with no commit needed.

---

## Self-Review Notes

- **Spec coverage:** Design doc §2 (.sdfrec format) → Task 1, directly transcribing `docs/sdfrec-format-spec.md`. §3 (file structure) → Tasks 1-4. §4 (Worker architecture) → Task 2. §5 (plugin UI) → Task 3. §6 (testing plan) → Tasks 1, 3 (and Task 2/4's explicit no-test rationale). §7 (backlog) → Task 5.
- **Placeholder scan:** No TBD/TODO. Task 4's Step 3 verification command is deliberately hedged (byte count may vary slightly) rather than asserting an exact untested number, and Task 6's Steps 3-4 explicitly allow "investigate and report" as a valid outcome for two specific, genuinely novel-to-this-codebase risks (Worker bundling in Next.js's build, and minified-bundle string search) rather than asserting false certainty.
- **Type consistency:** `SdfRecordingMachines`, `DecodedRecording`, `DecodedSample`, `DecodedMachine` (Task 1) are referenced identically in Task 2 (`WorkerResponse`'s `data: ReturnType<typeof decode>`) and Task 3 (`sessionRecorderPlugin.tsx`'s imports and `FactoryStoreShape` interface). The `{ok, data, error}` `WorkerResponse` shape is used identically in the Worker (Task 2) and the component's `worker.onmessage` handler (Task 3). `encode()`/`decode()` signatures match between the real TS implementation (Task 1) and the plain-JS reimplementation in the generator script (Task 4) — same field order, same types, same byte layout.
- **A note on the generator script's code duplication (Task 4):** the byte-encoding logic is genuinely duplicated between `sdfRecording.ts` (Task 1) and `generate-sample-sdfrec.mjs` (Task 4), rather than shared. This is a deliberate, scoped exception to DRY — the alternative (having a plain Node script `import` a TypeScript module) would require adding a TS-loader dependency or build step to `scripts/`, contradicting this project's established Phase 3a precedent that `scripts/` stays plain, dependency-free Node ESM. If the duplication ever drifts (e.g. the format gains a field in `sdfRecording.ts` but not the generator), the symptom would be Task 4 Step 3's fixture-validation check failing — that's an acceptable, cheap tripwire for a one-off dev script.
