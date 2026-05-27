# Product Requirements Document
# SDF Digital Twin Multi-Agent Simulator

**Version:** 1.0  
**Date:** 2026-05-27  
**Author:** Seunghoon Choi  
**Status:** Approved for Development

---

## 1. Executive Summary

The SDF (Software Defined Factory) Digital Twin Multi-Agent Simulator is a full-stack portfolio project that demonstrates two capabilities simultaneously: frontend rendering optimization at scale (Three.js + WebSocket + ECharts) and production-grade AI orchestration using a multi-agent Claude API pipeline. The system simulates a real factory floor in 3D, streams live sensor data from machines and robots, and triggers an autonomous AI agent chain that diagnoses faults, dispatches repair robots, and generates RICE-scored action plans — all visualized in real time.

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

### MVP Features (v1.0)

#### F-01: 3D Factory Floor Visualization
- Render a 20×20 grid factory floor with 5 stationary machines (press, CNC, conveyor types)
- Render 3 AMR robots that move smoothly on the floor
- Machine meshes change color based on status: blue (normal), amber (degraded), red (fault)
- Robot meshes move with smooth interpolation toward target positions
- Scene must remain stable and leak-free for continuous 24h operation

#### F-02: Real-Time Sensor Stream
- WebSocket connection to backend, streaming at ~10Hz
- 5 ECharts line charts (one per machine), each showing vibration (Hz) over time
- Charts update at a throttled 4Hz to avoid frame budget conflicts
- History ring buffer: last 300 data points per machine (30 seconds of data)

#### F-03: Fault Injection & Anomaly Detection
- Backend automatically injects a fault into a random machine every 60–120 seconds
- Fault state lasts 30 seconds, then clears
- Red AlertBanner appears in the UI immediately when a fault is detected

#### F-04: Multi-Agent AI Chain
- **Agent A (Diagnostic):** Analyzes 30-second sensor window, classifies fault type, severity, and confidence via Claude API
- **Agent B (Routing):** Selects nearest idle robot, computes waypoint path to faulted machine via Claude API
- **Agent C (Decision):** Computes RICE scores for three action options (immediate repair, scheduled maintenance, temporary bypass) via Claude API

#### F-05: Agent Chain UI Panel
- Live progress display: each agent shows "running" (with pulse animation) → "complete" with summary text
- Dispatch status card: shows which robot is en route to which machine with ETA
- Agent panel is persistent; shows last 9 agent events (covers 3 full chain runs)

#### F-06: Robot Dispatch Animation
- When Agent B fires a dispatch command, the target robot's position interpolates along the waypoint path in Three.js
- Robot status changes to "dispatched" (color change) during transit

### Post-MVP Features (v2.0 backlog)
- A* pathfinding with collision avoidance between robots
- Machine-type-specific 3D models (instead of uniform boxes)
- Agent report history: scrollable log of all past incidents
- WebGL instanced rendering for scaling to 50+ machines
- Mobile-responsive layout for Three.js scene

---

## 6. Technical Constraints

| Constraint | Requirement |
|---|---|
| Claude API | Uses `claude-sonnet-4-6` model; each agent call must complete within 10 seconds |
| WebSocket | Single persistent connection per client; backend must handle reconnection gracefully |
| Memory | Three.js scene must not exceed 200MB heap after 1 hour of operation |
| Deployment | Backend on Railway free tier ($5/month); frontend on Vercel free tier |
| Browser support | Chrome/Edge latest, Firefox latest; no IE or Safari <16 requirement |

---

## 7. User Stories

| ID | As a... | I want to... | So that... |
|---|---|---|---|
| US-01 | Visitor | See a 3D factory floor immediately on page load | I understand what the project is within 5 seconds |
| US-02 | Visitor | Watch machine charts update in real time | I can see the data pipeline is live |
| US-03 | Visitor | See a red alert appear and agent chain activate | I understand the AI orchestration is real, not faked |
| US-04 | Visitor | Read the agent summaries in plain language | I can evaluate the quality of the AI output |
| US-05 | Visitor | See a robot physically move to the faulted machine | I understand the dispatch loop is visualized end-to-end |
| US-06 | Builder | Build each layer (backend / frontend / agents) independently | I can verify each layer works before integrating |
| US-07 | Builder | Have unit tests for data models and agent parsers | I can refactor safely |

---

## 8. Acceptance Criteria

### AC-01: 3D Scene
- [ ] Page loads and Three.js scene renders within 3 seconds on a standard laptop
- [ ] 5 machine meshes and 3 robot meshes are visible
- [ ] Browser heap memory after 60 minutes continuous operation is within 20% of initial heap at load time

### AC-02: Sensor Data Pipeline
- [ ] ECharts charts update visibly every 250ms
- [ ] Chart history shows at least 30 seconds of data
- [ ] No dropped frames in Three.js when charts are updating simultaneously

### AC-03: Agent Chain
- [ ] Agent A fires within 5 seconds of fault injection
- [ ] Agent B fires after Agent A completes
- [ ] Agent C fires after Agent B completes
- [ ] All three agents show "complete" status in the Agent Panel within 40 seconds of fault injection
- [ ] Fallback messages appear (not crashes) if any Claude API call times out

### AC-04: Deployment
- [ ] Public URL is accessible
- [ ] WebSocket connects successfully in production (wss://)
- [ ] `/health` endpoint responds in < 500ms
- [ ] UptimeRobot keeps backend warm; no cold-start delays for visitors

---

## 9. Out of Scope

- Real factory hardware integration
- User authentication / authorization
- Persistent storage (database)
- Notifications (email/SMS) for alerts
- Multi-user collaboration
- Historical report export (PDF/CSV)
- Mobile-native app

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude API response parsing fails | Medium | Low | Regex-based JSON extraction + structured fallback for all three agents |
| Three.js memory leak in production | Medium | High | `disposeScene()` on unmount + geometry/material cache prevents duplicates |
| Railway free tier sleeps | High | High | UptimeRobot pings `/health` every 5 minutes |
| Claude API latency > 10s | Low | Medium | `asyncio.timeout(10)` per agent call; fallback returns gracefully |
| WebSocket flood causes UI jank | Medium | Medium | RAF drain queue decouples WS I/O from React render cycle |
