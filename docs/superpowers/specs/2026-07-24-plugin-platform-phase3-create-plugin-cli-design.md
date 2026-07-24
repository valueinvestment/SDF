# Phase 3a — `create-plugin` Scaffolding CLI

**Date:** 2026-07-24
**Status:** Approved (design)

## 0. Scope note

The roadmap's Phase 3 (`docs/superpowers/specs/2026-07-22-plugin-platform-roadmap-v2.md`, §Phase 3) bundles two independent pieces: a scaffolding CLI and a Plugin Inspector UI + registry introspection API. They don't share code paths, so per this project's brainstorming process they're split into two specs. This document covers **only the scaffolding CLI** ("Phase 3a"). The Plugin Inspector ("Phase 3b") gets its own brainstorming session and spec later.

## 1. Goal

Give contributors a one-command way to scaffold a new frontend example plugin, matching the shape Phase 2 established (`sensorChartPlugin.tsx`, `alertLogPlugin.tsx`): a panel component using `useStoreSlice`, a smoke test, and automatic registration into `apps/host-twin/lib/plugins.ts`. Backend (`Collector`/`PipelineStage`) templates are an explicit non-goal for this iteration — a fast-follow once this template's scaffolding mechanics are proven.

This replaces the roadmap's original "`npx create-sdf-plugin`" framing (a publishable npm package usable outside this repo) with a **local repo script** (`pnpm create-plugin <name>`), because contributors work by forking/cloning this monorepo (per `CONTRIBUTING.md`) and `SDFPlugin` only compiles inside this workspace today — there is no standalone plugin project this could scaffold outside the monorepo.

Storybook story generation (mentioned as optional in the roadmap) is out of scope: this repo has no Storybook setup at all (no config, no `.storybook/`, no existing `.stories.tsx` files), and standing that infrastructure up is a separate decision from this CLI. The generated plugin gets a component + a vitest test only, matching what Phase 2 actually shipped.

## 2. Architecture

A single plain Node.js ESM script, no new runtime dependency:

```
scripts/create-plugin.mjs          # the generator
package.json                       # root: "create-plugin": "node scripts/create-plugin.mjs"
```

Invoked as `pnpm create-plugin <name>`. Written in plain JS (not TypeScript) specifically to avoid adding `tsx`/`ts-node` as a new devDependency for a single script — the *generated* plugin code is still full TypeScript/TSX; only the generator itself is JS. Templates are inline template-literal strings — nothing here needs a templating engine given the single-file scale of what's being generated (matches how Phase 2's two example plugins were themselves single self-contained `.tsx` files).

A dedicated `packages/create-sdf-plugin` workspace package (with its own `bin` entry, publishable to npm) was considered and rejected for this iteration: this stays a local repo script, not a published package, so a full workspace package with its own build step is unnecessary ceremony.

## 3. Input & name derivation

```
pnpm create-plugin sensor-heatmap
```

One positional arg, required. Validated against `^[a-z][a-z0-9-]*$` (lowercase letters, digits, hyphens; must start with a letter) — reject anything else with a clear error and exit non-zero, nothing written.

Derivations from `sensor-heatmap`:
| Derived value | Result | Used for |
|---|---|---|
| Plugin id | `sensor-heatmap` | `SDFPlugin.id`, panel id (`sensor-heatmap-panel`) |
| PascalCase | `SensorHeatmap` | Component name (`SensorHeatmapPanel`), plugin const (`sensorHeatmapPlugin`) |
| camelCase file stem | `sensorHeatmap` | File names |

Panel id is derived as `<id>-panel` (e.g. `sensor-heatmap-panel`) to mirror the `-panel` suffix convention already used by `example-sensor-chart-panel`/`example-alert-log-panel`. The plugin id itself does **not** get an `example-` prefix (unlike Phase 2's two demo plugins) — new scaffolds are for a contributor's real plugin, not another demo.

## 4. Generated files

**`apps/host-twin/plugins/<camelName>Plugin.tsx`:**

```tsx
"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

export function <PascalName>Panel(props: PluginProps) {
  // TODO: select the slice of host state your plugin needs, e.g.:
  //   props.useStoreSlice((s) => (s as YourStoreShape).machines["M1"])
  const state = props.useStoreSlice((s) => s)

  if (!state) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        <PascalName> 데이터 대기 중...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">플러그인: <PascalName></p>
      {/* TODO: render your plugin's UI here. Prefer packages/ui primitives
          per CONTRIBUTING.md's plugin guidance. */}
    </div>
  )
}

export const <camelName>Plugin: SDFPlugin = {
  id: "<id>",
  name: "<PascalName>",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "<id>-panel",
      label: "<PascalName>",
      component: (props) => <<PascalName>Panel {...props} />,
    })
  },
}
```

This follows the exact `PluginProps`/`SDFPlugin` shape finalized in Phase 2 — a generic, content-agnostic version of `sensorChartPlugin.tsx`'s structure (empty-state pattern, `useStoreSlice` usage, `DashboardErrorBoundary` wrapping which happens automatically via `PluginRegistry`, unchanged). It deliberately does **not** guess at machine IDs, chart libraries, or specific store shape beyond the `useStoreSlice` call itself — those are the contributor's job to fill in, marked with `TODO` comments.

**`apps/host-twin/plugins/__tests__/<camelName>Plugin.test.tsx`:**

```tsx
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { <PascalName>Panel } from "../<camelName>Plugin"

function makeFakeBindings(initial: unknown) {
  const state = initial
  const listeners = new Set<(s: unknown) => void>()
  return {
    getReadOnlyState: () => state,
    subscribe: (listener: (s: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addRule: () => {},
    addComputedMetric: () => {},
    registerPanelPosition: () => {},
  }
}

describe("<PascalName>Panel", () => {
  it("renders the placeholder empty state", () => {
    const props = createPluginProps(makeFakeBindings(null))
    render(<<PascalName>Panel {...props} />)
    expect(screen.getByText(/데이터 대기 중/)).toBeInTheDocument()
  })
})
```

One smoke test proving the scaffold typechecks, renders, and correctly wires `createPluginProps`/`useStoreSlice` — reusing the exact `makeFakeBindings` harness pattern from `sensorChartPlugin.test.tsx`/`alertLogPlugin.test.tsx`. The contributor is expected to replace/extend this once they fill in real logic.

## 5. Auto-registration into `plugins.ts`

The script reads `apps/host-twin/lib/plugins.ts` as text and performs two targeted string insertions (the same two edits Task 10 made by hand in Phase 2):
1. Insert `import { <camelName>Plugin } from "@/plugins/<camelName>Plugin"` after the last existing plugin import line.
2. Insert `<camelName>Plugin` into the `installedPlugins` array literal, before the closing `]`.

This is plain string manipulation (find the array literal via a regex anchored on `installedPlugins: SDFPlugin[] = [`), not an AST transform — proportionate to the file's current size and structure (a short, hand-maintained list). If the array or import block isn't found in the expected shape, the script aborts with an error rather than guessing.

## 6. Validation & error handling

Before writing anything, the script checks, in order:
1. **Name format** — matches `^[a-z][a-z0-9-]*$`. Fail fast with an example of a valid name.
2. **File collision** — neither `apps/host-twin/plugins/<camelName>Plugin.tsx` nor its test file already exists. Fail with the existing path if so.
3. **Id collision** — the derived panel id (`<id>-panel`) doesn't already exist. The script resolves this by reading each plugin file imported into `installedPlugins` (parsed from `plugins.ts`'s import list) and string-searching each for its `registerPanel({ id: "..." })` call, building the full set of currently-registered panel ids; it also always includes the built-in panel ids (`canvas`, `charts`, `agent`, `detail`, `rules`, `mes` — the same collision set `registerPanelPosition` already enforces at runtime). Fail with the colliding id if the derived id is in that set.

All three checks run before any file is written — no partial scaffold on failure. On success, the script prints the three file paths it touched/created and a one-line "next steps" hint (fill in the TODOs, run `pnpm --filter @sdf/host-twin test`).

## 7. Testing plan

`scripts/__tests__/create-plugin.test.mjs` (or equivalent), run via the project's existing vitest setup:
- Happy path: run the generator against a temp working copy of `apps/host-twin` (copy the real `plugins/` dir + `lib/plugins.ts` into a scratch temp dir, point the script at it via a `--target-dir` test-only override or environment variable), assert both generated files exist with the expected content, and `plugins.ts` contains the new import + array entry.
- Name validation rejects an invalid name (e.g. `Sensor_Heatmap`, `1abc`) without writing any files.
- File-collision check rejects a name whose target file already exists.
- Id-collision check rejects a name that collides with an already-installed plugin id or a built-in panel id.
- Generated component/test actually typechecks and passes (`pnpm --filter @sdf/host-twin typecheck` + `test` against the temp copy, or against the real repo in a follow-up integration check run once during manual verification, then removed).

## 8. Non-goals

- Backend (`Collector`/`PipelineStage`) template — fast-follow, not this iteration.
- Storybook story generation — no Storybook infra exists in this repo; separate decision.
- Publishing as a standalone npm package / working outside this monorepo.
- Interactive prompts — single positional arg only.
- AST-based code modification of `plugins.ts` — plain string insertion is sufficient at its current size/shape.
- The Plugin Inspector UI and `PluginRegistry` introspection API (`list()`, `getErrors(id)`) — that's Phase 3b, a separate spec.

## 9. Dependencies

None on Phase 1/4/4.5. Builds directly on Phase 0/2's `PluginProps`/`SDFPlugin`/`createPluginProps` contracts, which are already merged (Phase 0) or PR'd (Phase 2, PR #6) — per the roadmap's own Phase 3 dependency note ("Phase 0/1의 계약이 안정된 이후 착수"), this can start now since it only touches the frontend contract surface, unaffected by Phase 1's backend PR status.
