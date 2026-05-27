# Ideas & Future Directions
# SDF Digital Twin Multi-Agent Simulator

Ideas are grouped by category and tagged with estimated effort and impact.

**Effort:** S (< 1 day) · M (1–3 days) · L (1–2 weeks) · XL (2+ weeks)  
**Impact:** Low · Medium · High · Showcase (portfolio-defining)

---

## Visualization

### V-01: Machine-Type-Specific 3D Models
**Effort:** M · **Impact:** High  
Replace uniform box geometries with distinct shapes per machine type: a flat press (wide flat box), a CNC lathe (cylinder with housing), a conveyor (long thin box with belt texture). Dramatically improves visual realism without adding complexity.

### V-02: Robot Trail Visualization
**Effort:** S · **Impact:** Medium  
Render a fading line trail behind dispatched robots using `THREE.Line` with a custom shader that fades opacity over time. Makes dispatch paths visually legible.

### V-03: Particle Effects on Fault
**Effort:** M · **Impact:** High  
When a machine enters fault state, emit a particle system (sparks/smoke) using `THREE.Points` with a custom particle material. Creates an immediate visual signal that something is wrong. Dispose particles when fault clears.

### V-04: Isometric Camera Toggle
**Effort:** S · **Impact:** Medium  
Add a button to switch between perspective (3D immersive) and orthographic (isometric, top-down) cameras. Orthographic is easier to read for non-technical recruiters.

### V-05: WebGL Instanced Rendering
**Effort:** L · **Impact:** Medium (needed for V2 scale)  
Replace individual `THREE.Mesh` objects with `THREE.InstancedMesh` for machines and robots. Reduces draw calls from O(n) to O(1) per type. Required for scaling to 50+ machines without FPS drop.

### V-06: Floor Texture
**Effort:** S · **Impact:** Medium  
Replace the `GridHelper` with a textured plane using a concrete floor texture. Add subtle bump mapping. Adds visual depth for < 30 minutes of work.

### V-07: Real-Time Heatmap Overlay
**Effort:** M · **Impact:** Showcase  
Render a WebGL heatmap texture on the factory floor that shows "danger zones" based on proximity to faulted machines. Update the texture via `DataTexture` on each sensor tick. Visually striking and technically interesting.

---

## AI & Agent Intelligence

### A-01: Agent Memory via Context Window
**Effort:** M · **Impact:** High  
Pass the last 3 incident reports as context to each new Agent A call. This allows the diagnostic agent to notice recurring faults in the same machine and classify them as "chronic degradation" vs. one-off failures. Better AI output, minimal engineering.

### A-02: Streaming Agent Responses
**Effort:** M · **Impact:** Showcase  
Use `anthropic.messages.stream()` and forward token chunks over WebSocket as the agent "thinks." Renders the agent output as streaming text in the Agent Panel — the "AI typing live" effect. Visually compelling portfolio moment.

### A-03: Agent D — Predictive Maintenance Scheduler
**Effort:** L · **Impact:** Showcase  
Add a fourth agent that runs on a 5-minute timer (not triggered by faults). It reviews the sensor trend history across all machines and predicts which machine will fault next and when, based on vibration trend slope. Output: a maintenance schedule ranked by urgency.

### A-04: Feedback Loop — Agent Outcome Tracking
**Effort:** M · **Impact:** High  
After Agent B dispatches a robot and it "arrives," emit a `repair_complete` event. Agent C's next run for the same machine receives the repair outcome as context, allowing it to refine its RICE scoring over time (simulated learning loop).

### A-05: Multi-Model Comparison Panel
**Effort:** L · **Impact:** High  
Run Agent A on both `claude-haiku-4-5` and `claude-sonnet-4-6` simultaneously and display both results side-by-side in the UI. Shows model capability comparison as a live demo feature — directly relevant to AI engineering roles.

### A-06: Tool Use for Agent B
**Effort:** L · **Impact:** High  
Refactor Agent B to use Claude's tool use (function calling) instead of prompt-based JSON output. Define tools like `select_robot(robot_id)` and `plan_path(start, end)`. More robust parsing, more authentic "agentic" behavior, demonstrates tool-use proficiency.

### A-07: Agent Confidence Threshold Tuning
**Effort:** S · **Impact:** Medium  
Add a UI slider that controls the minimum confidence threshold for Agent A to trigger the chain. If Agent A returns confidence < threshold, it emits a "monitoring" status instead of firing B and C. Demonstrates configurable AI sensitivity.

---

## Data Pipeline

### D-01: Backpressure Metrics Dashboard
**Effort:** M · **Impact:** Medium  
Track WebSocket message queue depth on the frontend and display it as a small indicator. When queue depth exceeds 50, show a "catching up" badge. Demonstrates awareness of real-time system health — good talking point.

### D-02: Simulated OPC-UA Namespace
**Effort:** L · **Impact:** High  
Replace the custom sensor format with OPC-UA node IDs (`ns=2;s=Machine1.Vibration`) and structure the sensor data as an OPC-UA address space. Pure simulation — no real OPC-UA server — but demonstrates domain knowledge of industrial protocols.

### D-03: WebSocket Reconnection with State Sync
**Effort:** M · **Impact:** Medium  
On reconnect, frontend requests a "state snapshot" via a `GET /state` REST endpoint to re-hydrate the Zustand store instantly, rather than waiting for the next sensor tick to repopulate. Prevents blank charts on reconnect.

### D-04: Redis Pub/Sub for Multi-Instance Backend
**Effort:** L · **Impact:** Medium  
Replace the in-process `EventBus` with Redis pub/sub. Allows the backend to scale horizontally (multiple Railway instances behind a load balancer). Required for production scale, good architecture discussion point.

### D-05: Server-Side Downsampling
**Effort:** M · **Impact:** Medium  
For the ECharts historical view, send full-resolution data only for the last 30 seconds. For data older than 30 seconds (if a history endpoint is added), downsample to 1Hz using LTTB (Largest Triangle Three Buckets) algorithm before transmitting. Standard time-series optimization technique.

---

## User Experience

### U-01: Machine Detail Panel (Click to Inspect)
**Effort:** M · **Impact:** High  
Clicking a machine mesh in Three.js opens a detail panel showing all three sensor values (vibration, temperature, current) as separate ECharts gauges. Demonstrates raycasting in Three.js and richer sensor data visualization.

### U-02: Speed Control (Simulation Time Multiplier)
**Effort:** S · **Impact:** Medium  
Add a UI control (1x / 5x / 10x) that multiplies the simulator tick rate and compresses fault injection intervals proportionally. Lets a visitor trigger the agent chain in 10 seconds instead of 90. Critical for live demos.

### U-03: Incident History Log
**Effort:** M · **Impact:** Medium  
Scrollable sidebar log of all past incidents with timestamp, machine, fault classification, and RICE recommendation. Gives the demo depth — shows this isn't a one-trick visualization.

### U-04: Dark / Industrial Theme Toggle
**Effort:** S · **Impact:** Low  
Add a theme toggle between the dark `gray-950` background and a lighter "industrial" theme with white backgrounds and blue accents. Minimal work, shows UI polish awareness.

### U-05: Export Agent Report as PDF
**Effort:** M · **Impact:** Medium  
"Download Report" button on the Agent Panel that generates a PDF of the RICE report using `@react-pdf/renderer`. Demonstrates that the AI output is actionable documentation, not just UI text.

---

## Robotics & Pathfinding

### R-01: A* Pathfinding
**Effort:** L · **Impact:** High  
Replace the straight-line waypoints from Agent B with a real A* implementation on the factory grid. Robots navigate around machine obstacles rather than through them. Implement in TypeScript on the frontend (pathfinding at dispatch time) or Python on the backend.

### R-02: Robot Collision Avoidance
**Effort:** XL · **Impact:** Showcase  
When two robots are dispatched simultaneously, implement collision avoidance using velocity obstacle (VO) or reciprocal velocity obstacle (RVO) algorithms. Robots dynamically reroute around each other. Technically demanding but visually impressive.

### R-03: Robot Idle Animation
**Effort:** S · **Impact:** Medium  
When a robot is idle, animate a slow rotation (spinning in place). When dispatched, the rotation stops and the robot moves. Adds life to the scene for < 30 minutes of work.

### R-04: Multi-Robot Dispatch
**Effort:** M · **Impact:** High  
Agent B currently dispatches one robot. Extend to dispatch two robots for high-severity faults (one for repair, one for parts delivery). Requires updating the `DispatchCommand` schema to support arrays and coordinating two animated paths.

---

## Infrastructure & DevX

### I-01: Docker Compose Local Dev
**Effort:** S · **Impact:** Medium  
Add a `docker-compose.yml` that starts both frontend and backend with a single `docker compose up`. Simplifies onboarding for anyone cloning the repo.

### I-02: GitHub Actions CI
**Effort:** S · **Impact:** Medium  
Workflow that runs `pytest` (backend) and `vitest` (frontend) on every push to `main`. Shows professional engineering habits in the repository.

### I-03: Playwright E2E Test
**Effort:** M · **Impact:** High  
A Playwright test that: loads the page, waits for the 3D canvas to render, injects a fault via a test API endpoint, waits for the AlertBanner to appear, and asserts the Agent Panel shows three complete events. Demonstrates E2E testing knowledge.

### I-04: Storybook for UI Components
**Effort:** M · **Impact:** Low  
Add Storybook stories for `AgentPanel`, `AlertBanner`, and `SensorChart` with mocked data. Documents the component API and demonstrates component-driven development practice.

### I-05: WebSocket Load Test
**Effort:** S · **Impact:** Medium  
A Python script using `asyncio` that opens 50 simultaneous WebSocket connections to the backend and measures message delivery latency per client. Documents the system's capacity ceiling.

---

## Portfolio-Specific Ideas

### P-01: "How It Works" Overlay
**Effort:** S · **Impact:** Showcase  
An info panel (toggled by a `?` button) that explains the system architecture in 5 bullet points, with labels pointing to the Three.js scene, the ECharts charts, and the Agent Panel. Helps non-technical visitors understand what they're looking at.

### P-02: Live Architecture Diagram
**Effort:** M · **Impact:** Showcase  
Render a live system architecture diagram (similar to the ASCII diagram in ARCHITECTURE.md) as SVG, with animated pulses showing data flowing from simulator → WebSocket → frontend → Three.js in real time. Synchronize pulse timing with actual WebSocket message receipt.

### P-03: Tech Stack Badge Panel
**Effort:** S · **Impact:** Low  
A footer row of technology badges (Next.js, Three.js, FastAPI, Claude API, etc.) with links to the documentation for each. Standard for portfolio projects.

### P-04: GitHub README with Demo GIF
**Effort:** S · **Impact:** High  
Record a 20-second GIF or MP4 of the full agent chain firing (fault → alert → A→B→C → robot movement). Embed in the README. Most hiring managers read the README before the code.
