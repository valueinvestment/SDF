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

  const allTimestamps = machineIds.flatMap((id) => machines[id].map((row) => row[0]))
  const sessionStartTs = allTimestamps.length > 0 ? Math.min(...allTimestamps) : Date.now()

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
