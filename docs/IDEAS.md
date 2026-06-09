# Ideas & Future Directions
# SDF Digital Twin Multi-Agent Simulator

Ideas are grouped by category and tagged with estimated effort, impact, and status.

**Effort:** S (< 1 day) · M (1–3 days) · L (1–2 weeks) · XL (2+ weeks)
**Impact:** Low · Medium · High · Showcase (portfolio-defining)
**Status:** ✅ Done · 🔄 In Progress · ⬜ Backlog

---

## Visualization

### V-01: Machine-Type-Specific 3D Models
**Effort:** M · **Impact:** High · ⬜ Backlog
Replace uniform box geometries with distinct shapes per machine type: a flat press (wide flat box), a CNC lathe (cylinder with housing), a conveyor (long thin box with belt texture). Dramatically improves visual realism without adding complexity.

### V-02: Robot Trail Visualization
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Render a fading line trail behind dispatched robots using `THREE.Line` with a custom shader that fades opacity over time. Makes dispatch paths visually legible.

### V-03: Particle Effects on Fault
**Effort:** M · **Impact:** High · ⬜ Backlog
When a machine enters fault state, emit a particle system (sparks/smoke) using `THREE.Points` with a custom particle material. Creates an immediate visual signal that something is wrong. Dispose particles when fault clears.

### V-04: Isometric Camera Toggle
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Add a button to switch between perspective (3D immersive) and orthographic (isometric, top-down) cameras. Orthographic is easier to read for non-technical recruiters.

### V-05: WebGL Instanced Rendering
**Effort:** L · **Impact:** Medium (needed for V2 scale) · ⬜ Backlog
Replace individual `THREE.Mesh` objects with `THREE.InstancedMesh` for machines and robots. Reduces draw calls from O(n) to O(1) per type. Required for scaling to 50+ machines without FPS drop.

### V-06: Floor Texture
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Replace the `GridHelper` with a textured plane using a concrete floor texture. Add subtle bump mapping. Adds visual depth for < 30 minutes of work.

### V-07: Real-Time Heatmap Overlay
**Effort:** M · **Impact:** Showcase · ⬜ Backlog
Render a WebGL heatmap texture on the factory floor that shows "danger zones" based on proximity to faulted machines. Update the texture via `DataTexture` on each sensor tick. Visually striking and technically interesting.

### V-08: Entity Label in 3D Scene
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Render the entity label (e.g., "프레스 #3") as a `CSS2DObject` floating above each mesh. Helps visitors understand the 3D scene without needing the Palette sidebar. Uses Three.js's `CSS2DRenderer` alongside the WebGL renderer.

---

## AI & Agent Intelligence

### A-01: Agent Memory via Context Window
**Effort:** M · **Impact:** High · ⬜ Backlog
Pass the last 3 incident reports as context to each new Agent A call. This allows the diagnostic agent to notice recurring faults in the same machine and classify them as "chronic degradation" vs. one-off failures.

### A-02: Streaming Agent Responses
**Effort:** M · **Impact:** Showcase · ⬜ Backlog
Use `anthropic.messages.stream()` and forward token chunks over WebSocket as the agent "thinks." Renders the agent output as streaming text in the Agent Panel — the "AI typing live" effect. Visually compelling portfolio moment.

### A-03: Agent D — Predictive Maintenance Scheduler
**Effort:** L · **Impact:** Showcase · ⬜ Backlog
Add a fourth agent that runs on a 5-minute timer (not triggered by faults). It reviews the sensor trend history across all machines and predicts which machine will fault next and when, based on vibration trend slope. Output: a maintenance schedule ranked by urgency.

### A-04: Feedback Loop — Agent Outcome Tracking
**Effort:** M · **Impact:** High · ⬜ Backlog
After Agent B dispatches a robot and it "arrives," emit a `repair_complete` event. Agent C's next run for the same machine receives the repair outcome as context, allowing it to refine its RICE scoring over time (simulated learning loop).

### A-05: Multi-Model Comparison Panel
**Effort:** L · **Impact:** High · ⬜ Backlog
Run Agent A on both `claude-haiku-4-5` and `claude-sonnet-4-6` simultaneously and display both results side-by-side in the UI. Shows model capability comparison as a live demo feature.

### A-06: Tool Use for Agent B
**Effort:** L · **Impact:** High · ⬜ Backlog
Refactor Agent B to use Claude's tool use (function calling) instead of prompt-based JSON output. Define tools like `select_robot(robot_id)` and `plan_path(start, end)`. More robust parsing, more authentic "agentic" behavior.

### A-07: Agent Confidence Threshold Tuning
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Add a UI slider that controls the minimum confidence threshold for Agent A to trigger the chain. If Agent A returns confidence < threshold, it emits a "monitoring" status instead of firing B and C.

---

## Data Pipeline

### D-01: Backpressure Metrics Dashboard
**Effort:** M · **Impact:** Medium · ⬜ Backlog
Track WebSocket message queue depth on the frontend and display it as a small indicator. When queue depth exceeds 50, show a "catching up" badge.

### D-02: Simulated OPC-UA Namespace
**Effort:** L · **Impact:** High · ⬜ Backlog
Replace the custom sensor format with OPC-UA node IDs (`ns=2;s=Machine1.Vibration`) and structure the sensor data as an OPC-UA address space. Pure simulation — no real OPC-UA server — but demonstrates industrial protocol domain knowledge.

### D-03: State Snapshot on Reconnect
**Effort:** M · **Impact:** Medium · ⬜ Backlog
On WS reconnect, frontend currently resends `sync_entities` (entity layout) but sensor history is lost. Add a `GET /state` REST endpoint to re-hydrate machine sensor history from the last 30 seconds. Prevents blank charts on reconnect.

### D-04: Redis Pub/Sub for Multi-Instance Backend
**Effort:** L · **Impact:** Medium · ⬜ Backlog
Replace the in-process `EventBus` with Redis pub/sub. Allows the backend to scale horizontally (multiple Railway instances behind a load balancer).

### D-05: Session Persistence for Entity Layout
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Persist `placedEntities` to `localStorage` so the user's canvas layout survives page refresh. On load, read from localStorage and immediately send `sync_entities` to the backend. Zero backend changes needed.

---

## User Experience

### U-01: Machine Detail Panel ✅ Done
Implemented in v1.1. Wear bars + thermal heatmap streamed at 2Hz. Accessible via Palette or 3D canvas click.

### U-02: Speed Control (Simulation Time Multiplier)
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Add a UI control (1x / 5x / 10x) that multiplies the simulator tick rate and compresses fault injection intervals proportionally. Lets a visitor trigger the agent chain in 10 seconds instead of 90. Critical for live demos.

### U-03: Incident History Log ✅ Done
Implemented in v1.1. `AlertHistory` component shows past incidents with timestamps and AI resolution summaries.

### U-04: Dark / Industrial Theme Toggle
**Effort:** S · **Impact:** Low · ⬜ Backlog
Add a theme toggle between the dark `gray-950` background and a lighter "industrial" theme with white backgrounds and blue accents.

### U-05: Export Agent Report as PDF
**Effort:** M · **Impact:** Medium · ⬜ Backlog
"Download Report" button on the Agent Panel that generates a PDF of the RICE report using `@react-pdf/renderer`. Demonstrates that the AI output is actionable documentation.

### U-06: Entity Label Editing
**Effort:** S · **Impact:** Low · ⬜ Backlog
Allow users to double-click an entity name in the Palette to rename it. Label is stored in `placedEntities` in the Zustand store and synced to backend as part of `sync_entities`. Adds personalization to the demo.

### U-07: Dynamic Canvas ✅ Done
Implemented in v1.1. Add Entity Modal with 5-per-type limit. Palette sidebar shows placed entities dynamically. Bidirectional WS sync keeps backend in step with frontend entity list.

---

## Robotics & Pathfinding

### R-01: A* Pathfinding
**Effort:** L · **Impact:** High · ⬜ Backlog
Replace the straight-line waypoints from Agent B with a real A* implementation on the factory grid. Robots navigate around machine obstacles rather than through them.

### R-02: Robot Collision Avoidance
**Effort:** XL · **Impact:** Showcase · ⬜ Backlog
When two robots are dispatched simultaneously, implement collision avoidance using velocity obstacle (VO) or reciprocal velocity obstacle (RVO) algorithms. Technically demanding but visually impressive.

### R-03: Robot Idle Animation
**Effort:** S · **Impact:** Medium · ⬜ Backlog
When a robot is idle, animate a slow rotation (spinning in place). When dispatched, the rotation stops and the robot moves.

### R-04: Multi-Robot Dispatch
**Effort:** M · **Impact:** High · ⬜ Backlog
Agent B currently dispatches one robot. Extend to dispatch two robots for high-severity faults (one for repair, one for parts delivery). Requires updating `DispatchCommand` schema to support arrays.

---

## Component Architecture

### C-01: HeadlessUI Component Library Extraction
**Effort:** L · **Impact:** Showcase · ⬜ Backlog
Extract the UI components (AddEntityModal, Palette, MachineDetailPanel, SensorChart) into a separate headless + styled layer pattern. Publish the headless logic as an OSS npm package. See `docs/Skill.md` for the implementation pattern.

### C-02: Storybook for UI Components
**Effort:** M · **Impact:** Medium · ⬜ Backlog
Add Storybook stories for `AgentPanel`, `AlertBanner`, `SensorChart`, `AddEntityModal` with mocked data. Validates the Headless/Styled split — if a component can be storied without real WebSocket data, the separation is working.

---

## Infrastructure & DevX

### I-01: Docker Compose Local Dev
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Add a `docker-compose.yml` that starts both frontend and backend with a single `docker compose up`.

### I-02: GitHub Actions CI
**Effort:** S · **Impact:** Medium · ⬜ Backlog
Workflow that runs `pytest` (backend) and `vitest` (frontend) on every push to `main`.

### I-03: Playwright E2E Test
**Effort:** M · **Impact:** High · ⬜ Backlog
A Playwright test that: loads the page, waits for the 3D canvas to render, adds an entity via the modal, waits for it to appear in the Palette, selects it, and asserts the detail panel renders.

### I-04: WebSocket Load Test
**Effort:** S · **Impact:** Medium · ⬜ Backlog
A Python script using `asyncio` that opens 50 simultaneous WebSocket connections to the backend and measures message delivery latency per client.

---

## Portfolio-Specific Ideas

### P-01: "How It Works" Overlay
**Effort:** S · **Impact:** Showcase · ⬜ Backlog
An info panel (toggled by a `?` button) that explains the system architecture in 5 bullet points with labels pointing to the Three.js scene, the ECharts charts, and the Agent Panel.

### P-02: Live Architecture Diagram
**Effort:** M · **Impact:** Showcase · ⬜ Backlog
Render a live system architecture diagram as SVG, with animated pulses showing data flowing from simulator → WebSocket → frontend → Three.js in real time. Synchronize pulse timing with actual WebSocket message receipt.

### P-03: GitHub README with Demo GIF
**Effort:** S · **Impact:** High · ⬜ Backlog
Record a 20-second GIF of the full agent chain firing (fault → alert → A→B→C → robot movement). Embed in the README. Most hiring managers read the README before the code.
