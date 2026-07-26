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
