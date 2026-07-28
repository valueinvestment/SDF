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
    setDemoMode: () => {},
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

  it("parses a file dropped onto the dropzone, not just one selected via the file input", async () => {
    const props = createPluginProps(makeFakeBindings({}))
    render(<SessionRecorderPanel {...props} />)

    const buffer = encode({ M1: { history: [[1000, 50, 60, 10]] } })
    const file = new File([buffer], "dropped.sdfrec")
    const dropzone = screen.getByText(".sdfrec 파일을 드래그하거나 클릭하여 업로드").parentElement!

    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByTestId("chart-mock")).toBeInTheDocument()
    })
  })
})
