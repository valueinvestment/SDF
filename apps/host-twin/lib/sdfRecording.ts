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

  const allTimestamps = machineIds.flatMap((id) => machines[id].history.map((row) => row[0]))
  const sessionStartTs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : Date.now()

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
