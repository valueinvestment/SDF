# Engineering Decisions — SDF Digital Twin

A comprehensive, source-verified catalog of the engineering decisions behind this project, organized by subsystem. Each entry follows the same structure: **why it was needed**, **what would have broken without it**, and **what improved once it shipped**. Every claim here is traceable to a specific file, commit, or test in this repository — see [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) for the system diagrams these decisions sit inside, and `docs/superpowers/specs/` / `docs/superpowers/plans/` for the full design-doc trail (13 design specs, 17 implementation plans) behind the plugin platform section.

**A shorter, hand-picked version formatted for direct resume-bullet drafting (XYZ formula) is at [`docs/RESUME_HIGHLIGHTS_TOP.md`](./RESUME_HIGHLIGHTS_TOP.md).**

---

## What this project is

A real-time 3D digital twin of a factory floor (Next.js + Three.js frontend, FastAPI + asyncio backend, persistent WebSocket) that also runs a three-agent Claude chain (diagnose → dispatch → RICE decision) on anomaly detection, a no-code visual builder (drag-and-drop entities, custom GLB models, freeform grid layout), and — the largest single body of work — a from-scratch, security-conscious plugin platform that lets third parties extend both the frontend and backend without forking the host app. 249 commits total; 177 of them are the plugin platform, built across 9 roadmap phases with a two-stage (spec compliance → code quality) review discipline on every task plus a final holistic review per phase. Combined test suite: 243 tests (169 frontend across Vitest, 74 backend pytest), all green.

---

## Part 1 — Core Real-Time Architecture

### 1.1 Three isolated rendering layers instead of one React tree

**Why needed:** The app has three fundamentally different update cadences fighting for the same 16ms frame budget: 3D robot positions arrive at 10Hz, sensor charts need to feel live without redrawing 10x/second, and the agent panel only changes on discrete events.

**What would break without it:** Writing 10Hz position updates into React state (even via a state manager) triggers React reconciliation on every write. At 10Hz with multiple robots, that's dozens of tree reconciliations per second — competing directly with Three.js's own `requestAnimationFrame` loop for the same frame budget, causing visible jank.

**What improved:** Robot positions bypass React/Zustand entirely — `useWebSocket` writes them straight into a `useRef` (`robotPosRef`), and the Three.js animate loop reads from that ref. **Zero React re-renders from position updates**, verifiable directly from the code (position writes never touch `useState`/Zustand). Sensor charts, by contrast, subscribe to Zustand directly and redraw on every update via ECharts' own Canvas renderer — a deliberately simpler path than the position pipeline, since correctness there only required isolating the two independent renderers from each other, not eliminating every re-render everywhere.

### 1.2 A dedicated FastAPI backend instead of Next.js API routes

**Why needed:** The app needs a persistent WebSocket connection and a continuously-running 10Hz simulation loop, plus Claude API calls that can take 3–8 seconds.

**What would break without it:** Vercel's serverless functions have a 10-second execution ceiling — coincidentally almost exactly the Claude API timeout budget this app needs, with zero margin, and serverless functions can't hold a WebSocket open indefinitely or run a background loop between requests.

**What improved:** A single long-running Python process (FastAPI + `asyncio`, deployed on Railway) runs the simulation loop, the WebSocket gateway, and the agent orchestrator as independent `asyncio` tasks in one event loop — no threads, no subprocesses, no execution-time ceiling.

### 1.3 A pub/sub EventBus instead of direct function calls between simulator and consumers

**Why needed:** The simulation loop's output has two consumers with wildly different speed profiles: the WebSocket broadcaster (must never be delayed) and the agent orchestrator (blocks for seconds on a Claude API call once triggered).

**What would break without it:** A direct function call from the simulator to "notify everyone" would mean the fast WebSocket path inherits the slow agent path's latency — the sensor stream would stutter every time an anomaly triggered an AI diagnosis.

**What improved:** An `asyncio.Queue`-per-subscriber `EventBus` gives the orchestrator its own private queue. The orchestrator can block on a multi-second Claude chain and the 10Hz broadcast loop is provably unaffected — verified in practice, not just in theory, since the chain runs as its own `asyncio.create_task()`.

### 1.4 An explicit entity-category registry instead of ID-prefix string matching

**Why needed:** Early in the project, entity type was inferred from ID prefixes (`M1`, `R1`). Once users could place their own entities with generated IDs (`press-1749375234123`), prefix matching had nothing to match against.

**What would break without it:** Every place that needed to know "is this a machine or a robot" — panel routing on the frontend, detail-stream routing on the backend — would silently misroute or drop dynamically-created entities, since `startswith("M")` doesn't recognize `press-...`.

**What improved:** An explicit `entity_id → category` registry (backend) and `placedEntities.find(id)?.type` lookup (frontend), both populated by the `sync_entities` reconciliation message, made the registry — not ID string shape — the primary source of truth for routing. The backend keeps a legacy `startswith("M")`/`startswith("R")` fallback for entities that haven't been synced yet, deliberately left in place rather than removed outright; new entity types added going forward route correctly through the registry without needing a matching prefix convention.

### 1.5 Full-state `sync_entities` reconciliation instead of incremental add/remove messages

**Why needed:** The frontend and backend need to agree on which entities exist, across reconnects, out-of-order messages, and missed events.

**What would break without it:** Incremental add/remove messages require perfect delivery ordering — a single dropped or reordered message leaves frontend and backend permanently disagreeing about what exists, with no self-correction.

**What improved:** A full-state sync (sent on WS open and on every `placedEntities` change) is idempotent by construction — the backend always converges to the correct state regardless of message loss or ordering, at negligible cost since the payload tops out around 20 entities.

### 1.6 Model selection: Claude Sonnet over Opus for the three-agent chain

**Why needed:** Three sequential Claude calls per anomaly (diagnose, route, decide), each needing to return clean structured JSON reliably and fast enough to feel responsive in a live dashboard.

**What would break without it:** Opus adds latency without a corresponding quality gain on these specific, narrowly-scoped, well-prompted extraction tasks (fault classification, nearest-robot routing, RICE scoring) — a straight cost/latency tax for zero user-visible benefit.

**What improved:** Sonnet hits the accuracy bar for structured extraction at meaningfully lower latency and cost, keeping the full three-agent chain fast enough that a 10-second-per-agent timeout with typed fallback is a genuine safety net, not the expected path.

---

## Part 2 — No-Code Builder Extensions

### 2.1 Custom GLB/GLTF model injection without a backend file store

**Why needed:** Users wanted to place their own 3D models (not just the built-in machine/robot shapes) without needing file-upload infrastructure.

**What would break without it:** A naive implementation would either require a backend asset store (real infra cost, real security surface for arbitrary file uploads) or would re-parse the same GLTF file on every reference, burning GPU memory and load time.

**What improved:** Models load via browser-memory `ObjectURL`/external URL only — zero backend storage needed. A URL-keyed parse cache means the same model referenced twice loads once and clones on reuse. An explicit `gltfLoadingRef` guard (a `Set` of in-flight entity IDs) prevents the animate loop from double-issuing a load for the same entity — a real race the animate loop's per-frame re-invocation would otherwise hit constantly.

### 2.2 A deliberate, documented exception in the entity-sync category mapping

**Why needed:** Custom GLB models needed to participate in the existing sensor/detail streaming pipeline (so `SensorChart` and `MachineDetailPanel` work for them too) without adding a new code path.

**What would break without it (and why this isn't just "left for later"):** The natural-looking fix — giving `custom` its own `category` value in the sync payload — would silently break detail streaming, because the backend gateway's `if/elif` only recognizes `machine`/`robot`; a `custom` category would fall through, `get_entity_category()` would return `None`, and the detail panel would go blank with no error anywhere. This is documented explicitly in `ARCHITECTURE.md` precisely so a future contributor doesn't "fix" it into breaking it.

**What improved:** Mapping every non-robot entity (including `custom`) to `category: "machine"` means the backend needs **zero changes** to support custom models — the existing machine pipeline just works, and the non-obvious trap is written down instead of waiting to be rediscovered by a bug report.

### 2.3 Migrating the grid layout manager from CSS-Grid span strings to integer coordinates

**Why needed:** The layout manager needed real drag/resize interaction (`react-grid-layout`), which speaks in `{x, y, w, h}` integers, not CSS-Grid's `"1 / 3"` span-string format.

**What would break without it:** Keeping the old string format would mean either not adopting a maintained drag-layout library at all, or translating between two coordinate systems on every interaction — a persistent source of off-by-one bugs.

**What improved:** A clean `LayoutConfig.version: 2` migration with a graceful fallback — `importConfig` detects a stale version and resets to the v2 default rather than crashing on old share-links, so existing shared URLs degrade instead of breaking outright. The library's deprecated `WidthProvider` HOC was deliberately avoided in favor of a `ResizeObserver`-based `useContainerWidth()` hook, kept consistent with the project's existing ResizeObserver usage elsewhere (documented as a specific choice, not an accident).

### 2.4 A pure, unit-tested function for URL-vs-localStorage config serialization strategy

**Why needed:** Custom models and freeform layouts can inflate the exported config JSON well past what fits safely in a URL.

**What would break without it:** Silently exceeding browser/server URL length limits produces broken share-links with no clear failure mode for the user.

**What improved:** `decideSyncStrategy()` is extracted as a pure function with a conservative `4000`-character floor, fully unit-testable without a DOM — URL when it fits, `localStorage` fallback + a warning toast when it doesn't. The strategy decision itself is testable in isolation from the browser APIs that consume it.

---

## Part 3 — The Plugin Platform (9 Phases, 177 commits)

The largest body of work in the project: turning a single-purpose dashboard into an extensible platform where third-party contributors can add frontend panels, backend data collectors, and processing stages — without forking the host app, and with an explicit, load-bearing decision about where the trust boundary actually sits once dynamic code loading enters the picture.

### 3.0 Process decision: two-stage review + a final holistic pass, on every single task

**Why needed:** A 9-phase, multi-session project needs a way to catch real bugs before they compound across phases, without a human reviewer available for every commit.

**What would break without it:** Self-reported "done" from an implementer (human or AI) is optimistic by default — issues that are invisible from inside a single task's diff (stale closures, unused-symbol lint breakage, test blind spots, cross-task interaction bugs) slip through if nothing independently re-derives the evidence.

**What improved — with receipts:** Every task in the plugin platform got a spec-compliance review (verify the code matches the requirement, nothing more/less) followed by a code-quality review (verify it's well-built), each done by re-reading the actual diff and re-running the actual tests rather than trusting the implementer's report. This process caught real, shipped-if-unchecked bugs across the platform — a representative sample, not the full list:
- Phase 0: a `subscribe` binding leaking direct store access, an orphan panel registration on built-in-ID collision, a read-only snapshot sharing a mutable reference with the live store.
- Phase 3a: a trailing comma silently corrupting a plugin-registration array into an `undefined` hole; an unwrapped `ENOENT` surfacing as a raw crash; a TOCTOU gap between existence-check and file write; a rollback path that covered 2 of 3 failure branches, found only by a final whole-branch review after every individual task had already passed.
- Phase 4.5: a missing shape check that would have silently killed the entire background plugin-loader task on the very first malformed plugin file.
- Phase 5b (most recent, most instructive): individual task reviews caught 3 real bugs (ESLint-breaking unused pre-staged symbols, a drag-and-drop test mock that never actually exercised the component's own payload-writing code, a data-loss bug where re-clicking an already-active UI tab silently discarded in-progress user input). A **4th bug was invisible to every single-task review and was only caught by a final holistic review of the entire branch diff**: re-scoping a rule's target machine mid-edit didn't re-validate the already-typed condition against the new scope, so a rule could be saved with a variable reference that didn't exist in its own machine's scope — permanently unfireable, with zero visible error. The first-instinct fix (just re-run validation) would not have worked, because React's state update is asynchronous and the validation closure would still read the pre-update value — the actual fix required passing the new scope as an explicit parameter instead of reading it from component state, which is exactly the class of subtle timing bug that's easy to "fix" in a way that looks correct but silently isn't.

### 3.1 A whitelist plugin context instead of direct store access

**Why needed:** Plugins need to read live sensor data and register UI, without being able to reach into arbitrary host internals.

**What would break without it:** Direct access to the host's Zustand store or React internals means every plugin author needs to independently understand the entire host app's internal shape to write a safe plugin, and any host refactor becomes a breaking change for every plugin.

**What improved:** `PluginContext` exposes exactly `store.getState`/`store.subscribe`/`registerPanel`/`registerRule`/`registerMetric` at activation time, and rendered panels get an even narrower `PluginProps` (`useStoreSlice` for read, `setDemoMode` — the platform's first-ever write method — added only when a real use case needed it). The host's internal state shape can change freely as long as this whitelist's contract holds.

### 3.2 Decoupling data collection from the broadcast loop (Collector/PipelineStage split)

**Why needed:** Real-world data collectors (Modbus, OPC-UA, REST polling) can be slow or unreliable; the existing 10Hz broadcast loop must never be at their mercy.

**What would break without it:** Awaiting a slow or hung real-device poll directly inside the 10Hz broadcast loop would stall the entire live dashboard for every connected client, not just the one machine with a flaky sensor.

**What improved:** Each `Collector` runs its own independent background task at its own cadence, writing into a shared cache; the broadcast loop only ever reads the cache, never awaits I/O. A collector going offline degrades gracefully (last-known-good state, then an explicit `"offline"` status after 3 missed polls) instead of hanging the whole system. This is the same pattern the codebase's own pre-existing `detail_loop`/`simulation_loop` split already used — recognized and reused rather than re-invented.

### 3.3 A render-bypass selector hook for plugin panels (`useStoreSlice`)

**Why needed:** Plugin panels subscribe to a 10Hz-updating store; naive subscription re-renders the panel on every tick regardless of whether the data the panel actually cares about changed.

**What would break without it:** A chart plugin watching one machine's history would re-render 10 times a second even while a completely unrelated machine's sensor value changed — the exact anti-pattern the core architecture (Part 1.1) was built to avoid, reintroduced at the plugin boundary if nobody had closed this gap.

**What improved:** `useStoreSlice` wraps `useSyncExternalStore` with selector-based deep-equality memoization, so a panel only re-renders when the value it actually selected changes — the whitelist API gets the same render-bypass guarantee as the built-in components, without plugin authors needing to know why.

### 3.4 The threat-model decision that shaped both dynamic-loading phases

**Why needed:** Once plugins can be loaded at runtime from a file a user drops in (frontend `.js` upload, backend `.py` directory poll) rather than only from source code reviewed at build time, the question "is the whitelist actually a security boundary" has to be answered honestly.

**What would break without it (the actual risk, not a hypothetical):** A same-realm `import()` shares the host's JS realm completely — `window`, `document`, the full prototype chain are always reachable no matter what object is passed to `activate(ctx)`. Treating the whitelist as a real security boundary while it's actually inert would be worse than no plugin system at all: a false sense of safety around genuinely unrestricted code execution.

**What improved:** Both the frontend (Phase 4) and backend (Phase 4.5) independently reached and documented the same honest conclusion: the whitelist is a mistake-prevention convention, not a security boundary, and this feature is explicitly scoped to trusted developers in development environments only — no iframe sandbox (incompatible with the existing "return JSX directly" panel contract), no subprocess isolation on the backend (the hot 10Hz pipeline can't afford IPC round-trips per tick). This is arguably the single most senior-engineering-judgment decision in the whole platform: correctly identifying that a plausible-looking security feature would not actually secure anything, and saying so in the design doc instead of shipping a false sense of safety.

### 3.5 A custom, deliberately simple session-recording format instead of implementing real MDF

**Why needed:** The roadmap originally called for exporting sensor history in the real MDF4 industrial measurement format.

**What would break without it (what was actually discovered):** Real MDF4 requires a linked block graph (IDBLOCK→HDBLOCK→DGBLOCK→CGBLOCK→CNBLOCK) plus deflate-compressed data blocks — a multi-week reference-implementation-scale undertaking for what was scoped as a single example plugin, discovered via research mid-brainstorming rather than mid-implementation.

**What improved:** Pivoted to a custom, from-scratch `.sdfrec` binary format (flat sequential header, no nested blocks) with a standalone, language-agnostic spec document — genuine domain utility (exports this app's own sensor history) without faking conformance to a standard the project was never going to fully implement. The pivot also caught a real bug during scale-testing: a `Math.min(...spread)` call that worked fine on a 25,000-sample fixture but stack-overflowed once the fixture was enlarged to 375,000 samples (V8's argument-count limit on spread calls) — invisible until the test fixture was deliberately enlarged to exercise the Worker-based parser's actual non-blocking value.

### 3.6 Discovering and reusing pre-existing mock-data logic instead of building a new generator

**Why needed:** The roadmap called for a demo mode that could replay data without a real backend connection.

**What would break without it:** Building a second, parallel mock-data generator when one already existed (an undocumented, pre-existing sine-wave + Gaussian-noise simulator that auto-activated on WebSocket disconnect) would have meant duplicate logic to maintain and a real risk of the two diverging.

**What improved:** The design phase found the existing generator before writing any new code, and the entire feature became "add an explicit toggle in front of a fallback that already existed" — zero new data-generation logic, just a `demoMode` flag threaded through `useWebSocket` and the platform's first-ever plugin write method (`setDemoMode`) to flip it from a panel. A feature that looked like a multi-day build from the roadmap description shipped as a targeted, minimal change once the actual codebase state was checked instead of assumed.

### 3.7 A CLI scaffold generator as a local script, not a published npm package

**Why needed:** Contributors need a fast way to generate a correctly-shaped plugin (component + test + registration) without hand-copying boilerplate.

**What would break without it:** Publishing a real `npx create-sdf-plugin` package would mean maintaining a second, independently-versioned distribution artifact for a tool that only makes sense inside this specific monorepo's structure.

**What improved:** `pnpm create-plugin <name>` is a dependency-free local script that generates the component, a smoke test, and auto-registers it — matching how contributors actually work (forking the monorepo, not installing from npm), avoiding a maintenance surface that wasn't needed.

### 3.8 A dev-only introspection panel sharing one error-classification path with the runtime

**Why needed:** Contributors need visibility into which plugins registered successfully, which failed, and why — without a separate debugging workflow for panel-ID conflicts versus render errors versus backend collector failures.

**What would break without it:** Ad-hoc console-log debugging across three unrelated failure surfaces (frontend panel-ID conflicts, frontend render errors, backend collector/pipeline errors) means every contributor re-derives the same debugging path from scratch.

**What improved:** A single shared error class (`PluginPanelConflictError`) thrown from both the registry and the host's panel-registration action means one `instanceof` check classifies failures correctly everywhere. The Inspector panel later gained render-error and backend-error sections that plug into the same classification path (Phase 6) — one coherent error-reporting surface instead of three independent ones, `NODE_ENV`-gated so it never ships to production by accident.

---

## Engineering practices demonstrated across all three parts

- **Root-cause fixes over workarounds** — the custom-model category mapping (2.2) and the whitelist threat-model conclusion (3.4) are both cases where the "obvious" fix would have introduced a worse, harder-to-find failure than the one being solved, and both are written down explicitly rather than left for the next person to rediscover.
- **Verify before building** — the demo-mode discovery (3.6) and the MDF format pivot (3.5) both came from checking actual codebase/domain reality during design, before writing implementation code, twice avoiding significant wasted effort.
- **Independent verification over trusting self-reports** — the two-stage-plus-holistic review process (3.0) is a deliberate structural answer to "how do you catch bugs that don't show up in a single diff," applied consistently across 9 phases and 177 commits, not just claimed once.
- **Honest engineering communication under uncertainty** — the "not a real security boundary" documentation (3.4) is the harder, less flattering conclusion to write down, chosen over a design doc that implies more safety than actually exists.
