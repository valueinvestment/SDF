# Top Resume-Ready Highlights — SDF Digital Twin

The 10 strongest, most defensible engineering decisions from this project, pre-formatted for the **XYZ resume-bullet formula** ("Accomplished **[X]**, measured by **[Y]**, by doing **[Z]**"). Full context and the other 9 decisions not included here are in [`docs/RESUME_HIGHLIGHTS.md`](./RESUME_HIGHLIGHTS.md).

**A note on honesty:** every number below is either a repository-verifiable count (tests, bugs, commits) or a directly-derivable technical claim (e.g., "zero re-renders" follows mechanically from the code — position writes never touch React state). There are no fabricated business metrics (revenue, users, "% faster") — this is a solo portfolio project, and inventing numbers an interviewer could ask you to defend in more detail would backfire. Use the technical specificity itself as the credibility signal.

---

## 1. Real-time 10Hz position pipeline with zero React re-renders

**Draft bullet:** *Eliminated all React re-renders from a 10Hz real-time position stream by routing updates through a `useRef` bypass read directly by the `requestAnimationFrame` render loop, keeping a dual-renderer (Three.js + React DOM) dashboard smooth under continuous high-frequency updates.*

- **X (what):** a 10Hz-updating 3D visualization stayed smooth alongside a React UI tree.
- **Y (measured by):** zero React reconciliations triggered by position data — a mechanically-verifiable property of the code (position writes go to `useRef`, never to `useState`/Zustand), documented as a measured characteristic in the architecture doc's performance table.
- **Z (how):** identified that the standard "put it in state" pattern would cause 10Hz reconciliation storms, and built a ref-based bypass consumed directly by the animation loop instead.
- **Why this is strong in an interview:** it's a concrete, explainable rendering-performance tradeoff you can whiteboard in 60 seconds, with a specific number (10Hz) and a specific mechanism (ref bypass), not a vague "optimized performance" claim.

## 2. Recognized and avoided a serverless timeout collision before it became a production incident

**Draft bullet:** *Chose a persistent FastAPI process over serverless API routes after identifying that the platform's 10-second execution ceiling would collide directly with the application's Claude API latency budget, avoiding random mid-response function terminations in production.*

- **X:** avoided a production reliability failure mode before it happened.
- **Y:** the resulting architecture has no execution-time ceiling at all for the WebSocket connection or the continuous 10Hz loop — not "enough margin under a limit," but the entire constraint category removed, since the alternative (Vercel's 10s serverless ceiling) left effectively zero margin against the app's own Claude API timeout budget.
- **Z:** ran a persistent process on a different platform (Railway) instead, sidestepping the constraint entirely rather than trying to shave milliseconds to fit under it.
- **Why this is strong:** shows infrastructure-constraint reasoning done *before* shipping, not incident-response reasoning done after — the harder, more valuable skill to demonstrate.

## 3. Decoupled slow AI latency from a real-time broadcast loop via per-subscriber queues

**Draft bullet:** *Designed a pub/sub event bus with per-subscriber queues to guarantee a 10Hz real-time broadcast loop was never delayed by a multi-second AI agent chain triggered from the same event stream.*

- **X:** a real-time data stream stayed responsive regardless of AI inference latency on the same event path.
- **Y:** the AI chain (3 sequential Claude calls, several seconds each) runs as an independent task; the broadcast loop's cadence is architecturally unaffected — not "usually fine," provably decoupled by construction (separate queue per subscriber).
- **Z:** built an `EventBus` giving each subscriber its own queue instead of a shared notification path, then ran the slow consumer as a fully independent background task.
- **Why this is strong:** concurrency/decoupling design is a classic interview topic — this gives you a real, shipped example instead of a hypothetical.

## 4. Replaced fragile ID-prefix string matching with an explicit routing registry

**Draft bullet:** *Introduced an explicit entity-category registry as the primary routing source of truth, replacing reliance on ID-prefix string matching (`startswith("M")`) for dynamically-created entities.*

- **X:** dynamically-generated entities (timestamp-based IDs, no fixed prefix) route correctly without depending on ID string shape.
- **Y:** every dynamically-generated entity ID now resolves through an explicit `sync_entities`-populated registry on both frontend and backend; the old prefix check remains only as a legacy fallback for entities that haven't synced yet, not as the primary routing mechanism.
- **Z:** introduced a registry populated by an explicit reconciliation message, so new entity types added going forward don't need a matching prefix convention to route correctly.
- **Why this is strong:** "found a fragile pattern and replaced it with something structurally sound" is a mid-to-senior signal — shows you think about bug *classes*, not individual bugs.

## 5. Made an honest, documented security-boundary call instead of shipping a false sense of safety

**Draft bullet:** *Evaluated a plugin whitelist API as a candidate security boundary for a runtime dynamic-code-loading feature, correctly determined it could not actually isolate untrusted code (same-JS-realm execution), and scoped the feature to trusted developers only rather than presenting an inert whitelist as real protection.*

- **X:** avoided shipping a security feature that looked protective but wasn't — arguably the single highest-judgment call in the project.
- **Y:** the conclusion was reached and documented independently on both the frontend (Phase 4) and backend (Phase 4.5) implementations of dynamic plugin loading, each with its own explicit threat-model write-up before implementation started.
- **Z:** traced through what a same-realm `import()` actually has access to (the full host JS realm — `window`, `document`, the prototype chain), concluded a whitelist object can't fence that off, and wrote the honest conclusion into the design doc instead of overstating the feature's safety.
- **Why this is strong:** this is the item to lead with if asked "tell me about a time you made a hard technical judgment call." It demonstrates security reasoning, intellectual honesty under pressure to ship a "safe-sounding" feature, and clear technical writing — three signals in one story.

## 6. Reused an existing resilience pattern instead of inventing a new one for external data sources

**Draft bullet:** *Designed a fault-tolerant data-collection layer (offline detection, stale-value fallback, per-collector isolation) for unreliable external data sources by recognizing and extending an existing decoupled-polling pattern already proven elsewhere in the codebase, instead of introducing a second, divergent resilience mechanism.*

- **X:** external data collectors (simulating real device integrations: Modbus, OPC-UA, REST polling) degrade gracefully instead of stalling the entire real-time pipeline.
- **Y:** a collector can miss up to 3 poll cycles before the system marks it offline (an explicit, tunable threshold) — until then, consumers see the last known-good value, never a stale error state or a frozen dashboard.
- **Z:** noticed the codebase already had a proven "decouple slow work from the hot loop" pattern (a 2Hz detail stream running independently of the 10Hz main loop) and extended the *same* pattern to external collectors instead of designing something new from scratch.
- **Why this is strong:** shows pattern recognition across a codebase and consistency discipline — not every decision needs to be a novel invention; recognizing when to reuse is its own skill.

## 7. Applied a security-of-the-quiet-kind fix: closed a render-performance regression before it could reach the plugin ecosystem

**Draft bullet:** *Extended a core rendering-performance guarantee (selective re-render via memoized store subscriptions) to a third-party plugin API surface, preventing the exact class of performance bug the core architecture was built to avoid from silently reappearing at the extension boundary.*

- **X:** third-party plugins get the same render-performance guarantee as first-party components, automatically, without needing to understand why.
- **Y:** a plugin subscribing to one data slice does not re-render on unrelated 10Hz store updates — the same zero-unnecessary-render property as item #1, now enforced at a boundary plugin authors don't control.
- **Z:** wrapped `useSyncExternalStore` with selector-based deep-equality memoization as the *only* store-access API exposed to plugins, closing off the possibility of a plugin author accidentally reintroducing a 10Hz re-render storm.
- **Why this is strong:** shows systems thinking — recognizing that an API boundary is exactly where a previously-solved problem can silently reappear, and closing it structurally rather than trusting every future plugin author to know better.

## 8. Built and ran a two-stage + holistic code review process that caught real, non-obvious bugs across every phase

**Draft bullet:** *Instituted a mandatory two-stage review (spec compliance, then code quality) for every implementation task across a 9-phase, 177-commit platform build, plus a final whole-branch holistic review per phase — catching and fixing real defects other engineers' single-task reviews would have missed, including one cross-task bug invisible to any individual diff.*

- **X:** caught and fixed real defects across a 9-phase platform build — including one cross-task bug that no individual task's review could have seen, because it only existed in the interaction between two separate tasks' code.
- **Y:** a partial rollback path covering only 2 of 3 failure branches (Phase 3a), a missing shape check that would have silently killed a background loader on its first malformed input (Phase 4.5), and a Phase 5b data-integrity bug where re-scoping a rule mid-edit didn't re-validate an already-typed condition — all found and fixed before merge, the last one specifically by the final whole-branch review after every individual task had already passed its own.
- **Z:** required every task to pass an independent spec-compliance check (re-reading the diff, not trusting the implementer's self-report) followed by a code-quality check, then added one more review pass across the *entire* branch diff after all individual tasks passed, specifically to catch what no single-task view could.
- **Why this is strong:** in 2026, "how do you use AI-assisted development responsibly" is an increasingly common interview question — this is a concrete, quantified answer: verification discipline, not blind trust in generated code, and a specific example of a bug class (cross-task interaction) that only a broader review layer catches.

## 9. Scoped down an unrealistic requirement via research, then caught a real scaling bug from the resulting design

**Draft bullet:** *Investigated a roadmap requirement to implement the industry-standard MDF4 binary format, determined via research (not trial-and-error implementation) that it required a multi-week reference-implementation-scale effort disproportionate to its scope as a single example feature, and designed a purpose-built alternative format instead — then caught a real V8 stack-overflow bug (`Math.min(...spread)`) during scale testing of the resulting implementation.*

- **X:** avoided a multi-week scope overrun by researching feasibility *before* implementation, and separately caught a real production-class bug through deliberate scale testing.
- **Y:** the format-complexity finding (linked block graph + compressed data blocks) was concrete enough to redirect the whole feature's design before any implementation code was written; the stack-overflow bug was invisible at a 25,000-sample test scale and only surfaced once the test fixture was deliberately enlarged to 375,000 samples to properly exercise the feature under realistic load — V8's spread-call argument-count ceiling sits well under that.
- **Z:** did feasibility research during the design/brainstorming phase instead of discovering the scope problem mid-implementation, and treated "does this still work at realistic scale" as a deliberate test dimension rather than assuming a small fixture was representative.
- **Why this is strong:** two distinct engineering virtues in one story — scoping judgment (know when to build a simpler purpose-built solution instead of a "correct" but oversized one) and rigorous testing discipline (scale testing catching what small-fixture testing couldn't).

## 10. Found and reused undocumented existing functionality instead of building a duplicate

**Draft bullet:** *Discovered, during design research, that a requested "demo mode" feature's core data-generation logic already existed in an undocumented mock-data generator, and shipped the feature as a minimal explicit-toggle addition instead of building a second, redundant data-generation system.*

- **X:** delivered a roadmapped feature with a fraction of the originally-scoped implementation work.
- **Y:** zero new data-generation logic was written — the entire feature became one boolean flag threaded through one hook, plus one new plugin write-method to toggle it from the UI, versus what the roadmap description implied was a from-scratch generator build.
- **Z:** checked actual current codebase state during the design phase before writing any implementation code, rather than assuming the roadmap's framing ("build a mode that...") meant nothing existed yet.
- **Why this is strong:** a concrete example of "measure twice, cut once" — verifying assumptions against reality before investing implementation effort, which reads as maturity rather than just speed.
