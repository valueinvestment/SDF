# Product Requirements Document
# SDF Digital Twin Multi-Agent Simulator

**Version:** 1.2
**Date:** 2026-06-09
**Author:** Seunghoon Choi
**Status:** Active Development

---

## 1. Executive Summary

The SDF (Software Defined Factory) Digital Twin Multi-Agent Simulator is a full-stack portfolio project that demonstrates two capabilities simultaneously: frontend rendering optimization at scale (Three.js + WebSocket + ECharts) and production-grade AI orchestration using a multi-agent Claude API pipeline. The system simulates a real factory floor in 3D, streams live sensor data from machines and robots, and triggers an autonomous AI agent chain that diagnoses faults, dispatches repair robots, and generates RICE-scored action plans — all visualized in real time.

Users can dynamically add and remove machines and robots on the canvas. The frontend and backend stay in sync over the existing WebSocket connection — no REST API required for entity management.

---

## 2. Problem Statement

Enterprise software engineers increasingly need to demonstrate fluency in both high-performance frontend systems and AI integration. Portfolio projects that show only one of these are common. This project demonstrates both in a single coherent product, with a domain (smart manufacturing / digital twin) that is recognizable and technically credible to engineering hiring managers.

---

## 3. Goals & Success Criteria

### Primary Goals
| Goal | Metric |
|---|---|
| Demonstrate frontend rendering optimization | Three.js scene runs at stable 60fps for 24h without memory leaks |
| Demonstrate AI orchestration depth | Full A→B→C agent chain fires, produces structured output, and is visible in UI |
| Be publicly accessible | Deployed URL returns a working demo within 5 seconds of cold start |
| Be technically impressive as a portfolio piece | Agent chain output is specific and meaningful, not generic filler text |
| Demonstrate interactive digital twin | Users can add/remove entities; backend immediately reflects changes in sensor data |

### Non-Goals
- This is not a production factory control system
- No real hardware integration or OPC-UA/MQTT connections
- No user authentication or multi-tenant support
- No persistent database for sensor history or reports

---

## 4. User Personas

**Primary: Engineering Hiring Manager / Technical Recruiter**
- Views the project via a public URL, typically for 2–5 minutes
- Assesses: Is this technically real? Does it demonstrate depth? Can this person build full-stack systems?
- Needs: A demo that is visually impressive on first load, with clear AI activity visible within 2 minutes

**Secondary: The Builder (Seunghoon)**
- Needs genuine learning value in building the system
- Wants code patterns that transfer to professional projects (multi-agent orchestration, 3D rendering optimization, real-time state management)

---

## 5. Product Scope

### v1.0 — Core Simulation (Released)

#### F-01: 3D Factory Floor Visualization
- 20×20 grid factory floor with machine and robot meshes
- Machine meshes change color based on status: blue (normal), amber (degraded), red (fault)
- Robot meshes move with smooth interpolation toward target positions
- Sub-mesh fault highlighting: individual machine components turn red on component_fault events

#### F-02: Real-Time Sensor Stream
- WebSocket connection to backend, streaming at ~10Hz
- ECharts line charts (one per placed machine), each showing vibration / temperature / current over time
- Charts update at a throttled 4Hz; history ring buffer: last 300 points (30 seconds)

#### F-03: Fault Injection & Anomaly Detection
- Backend automatically injects a fault into a random machine every 60–120 seconds
- Fault state lasts 30 seconds, then clears
- Red AlertBanner and Toast notification appear in the UI immediately

#### F-04: Multi-Agent AI Chain
- **Agent A (Diagnostic):** Classifies fault type, severity, confidence from 30-second sensor window
- **Agent B (Routing):** Selects nearest idle robot, computes waypoint path
- **Agent C (Decision):** RICE scores three response options, recommends the best one

#### F-05: Agent Chain UI Panel
- Live progress per agent: running → complete with summary text
- Dispatch status card: robot ID, target machine, ETA
- Alert history log: past incidents with timestamps and AI resolution summaries

#### F-06: Robot Dispatch Animation
- Target robot interpolates along waypoint path in Three.js when Agent B dispatches

---

### v1.1 — Dynamic Canvas & Detail Panels (Released)

#### F-07: Entity Placement System
- **Palette sidebar** shows all currently placed machines and robots
- **Add Entity Modal**: 2×2 grid of type cards (press / cnc / conveyor / robot) with per-type count badge
- Limit: **5 entities per type**. Cards are disabled (grayed out) when the limit is reached
- Click type card → modal closes → placement cursor active → click floor → entity placed
- Remove button (✕) on each Palette item removes entity from canvas and backend

#### F-08: Bidirectional WebSocket Entity Sync
- On WS connect and on any `placedEntities` change, frontend sends `sync_entities` to backend
- Backend reconciles `SensorSimulator` and `DetailSimulator` state: new entities start generating data immediately, removed entities are dropped
- No separate REST endpoint needed for entity management

#### F-09: Machine Detail Panel
- Selecting a machine in Palette or 3D canvas opens a detail panel (2Hz stream)
- Wear bars: per-component (body / motor / actuator / sensor_unit) wear percentage with ECharts bar chart
- Thermal heatmap: 4×4 grid showing temperature distribution as a color-coded grid
- Operation rate percentage displayed at top

#### F-10: Robot Detail Panel
- Selecting a robot opens a detail panel showing current position and patrol path
- Recommended path rendered as waypoints

---

### v2.0 — Backlog

- A* pathfinding with collision avoidance between robots
- Machine-type-specific 3D models (instead of uniform boxes)
- Streaming agent responses (token-by-token display in Agent Panel)
- WebGL instanced rendering for 50+ machine scale
- Agent D — Predictive Maintenance Scheduler (5-minute timer, trend analysis)
- Session persistence for entity layout (localStorage or backend state endpoint)
- Mobile-responsive layout

---

## 6. Technical Constraints

| Constraint | Requirement |
|---|---|
| Claude API | Uses `claude-sonnet-4-6` model; each agent call must complete within 60 seconds |
| WebSocket | Single persistent connection per client; bidirectional (frontend→backend for entity sync) |
| Memory | Three.js scene must not exceed 200MB heap after 1 hour of operation |
| Deployment | Backend on Railway; frontend on Vercel |
| Browser support | Chrome/Edge latest, Firefox latest |
| Entity limit | Max 5 per type (press / cnc / conveyor / robot) enforced on frontend |

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|---|---|---|---|
| US-01 | Visitor | See a 3D factory floor immediately on page load | I understand what the project is within 5 seconds |
| US-02 | Visitor | Watch machine charts update in real time | I can see the data pipeline is live |
| US-03 | Visitor | See a red alert appear and agent chain activate | I understand the AI orchestration is real, not faked |
| US-04 | Visitor | Read the agent summaries in plain language | I can evaluate the quality of the AI output |
| US-05 | Visitor | See a robot physically move to the faulted machine | I understand the dispatch loop is visualized end-to-end |
| US-06 | Visitor | Add a new machine to the canvas | I can interact with the digital twin, not just observe it |
| US-07 | Visitor | Select a machine and see its wear and thermal data | I understand the depth of detail available per entity |
| US-08 | Builder | Build each layer (backend / frontend / agents) independently | I can verify each layer works before integrating |
| US-09 | Builder | Have unit tests for data models and agent parsers | I can refactor safely |

---

## 8. Acceptance Criteria

### AC-01: 3D Scene
- [ ] Page loads and Three.js scene renders within 3 seconds on a standard laptop
- [ ] Default entities (M1–M5 machines, R1–R3 robots) are visible on load
- [ ] Browser heap memory after 60 minutes continuous operation is within 20% of initial heap

### AC-02: Sensor Data Pipeline
- [ ] ECharts charts update visibly every 250ms
- [ ] Chart history shows at least 30 seconds of data
- [ ] No dropped frames in Three.js when charts are updating simultaneously

### AC-03: Agent Chain
- [ ] Agent A fires within 5 seconds of fault injection
- [ ] All three agents show "complete" status within 40 seconds of fault injection
- [ ] Fallback messages appear (not crashes) if any Claude API call times out

### AC-04: Entity Placement
- [ ] "+ 추가" button opens the modal showing 4 type cards with current counts
- [ ] Clicking a card enters placement mode and the modal closes
- [ ] Clicking the canvas floor places the entity and it appears in the Palette
- [ ] Modal cards are disabled when count reaches 5
- [ ] Removing an entity from Palette removes it from the canvas and the backend simulator

### AC-05: Detail Panels
- [ ] Selecting a placed machine shows MachineDetailPanel with wear bars and thermal grid
- [ ] Selecting a placed robot shows RobotDetailPanel
- [ ] Detail panels work for both default entities (M1, R1) and dynamically added entities

### AC-06: Deployment
- [ ] Public URL is accessible
- [ ] WebSocket connects successfully in production (wss://)
- [ ] `/health` endpoint responds in < 500ms

---

## 9. Out of Scope

- Real factory hardware integration
- User authentication / authorization
- Persistent storage (database / localStorage)
- Notifications (email/SMS) for alerts
- Multi-user collaboration
- Mobile-native app

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude API response parsing fails | Medium | Low | Regex-based JSON extraction + typed fallback for all three agents |
| Three.js memory leak in production | Medium | High | `disposeScene()` on unmount + geometry/material cache prevents duplicates |
| Railway free tier sleeps | High | High | UptimeRobot pings `/health` every 5 minutes |
| Claude API latency > 60s | Low | Medium | `asyncio.timeout(60)` per agent call; fallback returns gracefully |
| WebSocket flood causes UI jank | Medium | Medium | RAF drain queue decouples WS I/O from React render cycle |
| Entity sync out-of-sync on reconnect | Low | Medium | Frontend sends full `sync_entities` on every WS open event |
