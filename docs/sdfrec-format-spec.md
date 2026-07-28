# SDFR (`.sdfrec`) File Format Specification

**Version:** 1
**Status:** Stable

## 1. Purpose

`.sdfrec` ("SDF Recording") stores a snapshot of SDF Digital Twin sensor history — one or more machines, each with a time series of channel readings — as a compact, self-describing binary file. It is designed to be simple enough to implement from this document alone, in any language, without reading the reference implementation.

## 2. Design Principles

- **Self-describing.** The channel set (names, count) is declared once in the header, not hardcoded by any reader. A file fully describes its own contents.
- **Compact.** No per-sample tags or padding. Each sample is a fixed-size record: a 4-byte time offset followed by one 4-byte value per channel, in the order declared in the header.
- **Flat, not nested.** Unlike block-graph formats (e.g. MDF), there are no linked lists of blocks and no absolute-offset pointers. The file is a single sequential header followed by a single sequential data section. A reader parses top to bottom exactly once.
- **Little-endian throughout.**

## 3. Layout

```
[Header]
  magic:          4 bytes, ASCII, must be "SDFR"
  version:        uint8 (this document describes version 1)
  sessionStartTs: float64  (epoch milliseconds — recording start time)
  channelCount:   uint8
  channels[channelCount]:
    nameLength:   uint8
    name:         nameLength bytes, ASCII
  machineCount:   uint16
  machines[machineCount]:
    idLength:     uint8
    id:           idLength bytes, UTF-8
    sampleCount:  uint32

[Data section]
  For each machine, in the same order as the machine table above,
  one contiguous run of that machine's samples:
    samples[sampleCount]:
      tsOffsetMs: uint32                  (milliseconds since sessionStartTs)
      values:     float32 × channelCount  (in channel-table order)
```

Per-sample size is fixed at `4 + 4 × channelCount` bytes. Channel and machine metadata is stored once in the header regardless of how many samples follow, so header overhead is amortized across the whole recording.

## 4. Field Notes

- **`magic`** identifies the file as SDFR before any other field is trusted. A reader MUST reject a file whose first 4 bytes are not `"SDFR"` (bytes `53 44 46 52`) without attempting to parse further.
- **`version`** allows the format to evolve. A reader MUST reject a version it does not recognize rather than guess at layout.
- **`sessionStartTs`** is the only absolute timestamp in the file. Per-sample timestamps are stored as `tsOffsetMs`, a `uint32` millisecond offset from `sessionStartTs` — this avoids repeating a 8-byte absolute timestamp (which would also lose precision if stored as `float32`) on every sample. `uint32` supports offsets up to ~49.7 days from `sessionStartTs`.
- **Sensor values** (`values[]`) are stored as `float32`. Simulated/measured sensor readings in this system do not require more precision than `float32` provides (~7 significant decimal digits), and halving each value's size versus `float64` meaningfully reduces file size at scale.
- **`nameLength`/`idLength`** are `uint8`, capping channel names and machine IDs at 255 bytes each. An encoder MUST reject input exceeding this limit rather than silently truncate.
- Channel and machine tables use fixed-width count fields (`channelCount: uint8`, `machineCount: uint16`) chosen to comfortably exceed any realistic count for this system while keeping the header itself compact.

## 5. Worked Example

A file with 1 channel (`"vibration"`), 1 machine (`"M1"`), 2 samples, `sessionStartTs = 1700000000000`:

**Header (33 bytes):**

| Offset | Size | Field | Value |
|---|---|---|---|
| 0 | 4 | `magic` | `53 44 46 52` ("SDFR") |
| 4 | 1 | `version` | `01` (1) |
| 5 | 8 | `sessionStartTs` | float64 LE = 1700000000000 |
| 13 | 1 | `channelCount` | `01` (1) |
| 14 | 1 | `channels[0].nameLength` | `09` (9) |
| 15 | 9 | `channels[0].name` | `76 69 62 72 61 74 69 6f 6e` ("vibration") |
| 24 | 2 | `machineCount` | `01 00` (1) |
| 26 | 1 | `machines[0].idLength` | `02` (2) |
| 27 | 2 | `machines[0].id` | `4d 31` ("M1") |
| 29 | 4 | `machines[0].sampleCount` | `02 00 00 00` (2) |

**Data section (16 bytes, offset 33–48):**

| Offset | Size | Field | Value |
|---|---|---|---|
| 33 | 4 | `sample[0].tsOffsetMs` | `00 00 00 00` (0) |
| 37 | 4 | `sample[0].values[0]` | float32 LE = 50.5 |
| 41 | 4 | `sample[1].tsOffsetMs` | `64 00 00 00` (100) |
| 45 | 4 | `sample[1].values[0]` | float32 LE = 51.2 |

Total file size: 49 bytes.

Full hex + ASCII dump of this exact example (verified by encoding it programmatically):

```
0000  53 44 46 52 01 00 00 80 56 fe bc 78 42 01 09 76  SDFR....V..xB..v
0016  69 62 72 61 74 69 6f 6e 01 00 02 4d 31 02 00 00  ibration...M1...
0032  00 00 00 00 00 00 00 4a 42 64 00 00 00 cd cc 4c  .......JBd.....L
0048  42                                               B
```

## 6. Reference Implementation

`apps/host-twin/lib/sdfRecording.ts` implements `encode()`/`decode()` for this specification. It is a direct transcription of this document — this document is the source of truth if the two ever disagree.
