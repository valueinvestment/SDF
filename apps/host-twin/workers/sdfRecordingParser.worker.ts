/// <reference lib="webworker" />
// Coexisting with the project's "dom"-lib tsconfig relies on skipLibCheck: true
// (dom.d.ts and webworker.d.ts both declare `self`/`onmessage`/etc. and conflict
// otherwise) — don't tighten skipLibCheck without accounting for this file.
import { decode, type DecodedRecording } from "@/lib/sdfRecording"

export interface WorkerResponse {
  ok: boolean
  data?: DecodedRecording
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
