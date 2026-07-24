# Phase 3a — `create-plugin` Scaffolding CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pnpm create-plugin <name>`, a zero-dependency Node script that scaffolds a new frontend example plugin (panel component + smoke test, matching Phase 2's `sensorChartPlugin.tsx`/`alertLogPlugin.tsx` shape) and auto-registers it into `apps/host-twin/lib/plugins.ts`.

**Architecture:** A single plain Node ESM script (`scripts/create-plugin.mjs`) built from small pure functions (name validation/derivation, template rendering, `plugins.ts` text insertion, existing-panel-id collection) plus a thin orchestration function and CLI entry point. Tested with Node's built-in `node:test` runner — no new devDependency, since this script lives outside the pnpm workspace (`scripts/` isn't in `pnpm-workspace.yaml`'s `packages:` list) and doesn't need a bundler or the monorepo's vitest setup.

**Tech Stack:** Plain Node.js (ESM, `.mjs`), `node:test` + `node:assert/strict`, `node:fs/promises`, `node:path`. Generated output is TypeScript/TSX consumed by the existing `@sdf/host-twin` vitest/tsc toolchain.

**Spec:** `docs/superpowers/specs/2026-07-24-plugin-platform-phase3-create-plugin-cli-design.md`

---

### Task 1: Name validation & derivation

**Files:**
- Create: `scripts/create-plugin.mjs`
- Test: `scripts/__tests__/create-plugin.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/create-plugin.test.mjs`:

```javascript
import { test } from "node:test"
import assert from "node:assert/strict"
import { validatePluginName, deriveNames } from "../create-plugin.mjs"

test("validatePluginName accepts a valid kebab-case name", () => {
  assert.doesNotThrow(() => validatePluginName("sensor-heatmap"))
})

test("validatePluginName rejects an empty name", () => {
  assert.throws(() => validatePluginName(""), /required/)
})

test("validatePluginName rejects undefined", () => {
  assert.throws(() => validatePluginName(undefined), /required/)
})

test("validatePluginName rejects uppercase letters", () => {
  assert.throws(() => validatePluginName("Sensor-Heatmap"), /Invalid plugin name/)
})

test("validatePluginName rejects underscores", () => {
  assert.throws(() => validatePluginName("sensor_heatmap"), /Invalid plugin name/)
})

test("validatePluginName rejects a name starting with a digit", () => {
  assert.throws(() => validatePluginName("1sensor"), /Invalid plugin name/)
})

test("deriveNames derives id, panelId, pascalName, camelName from a single-word name", () => {
  const result = deriveNames("heatmap")
  assert.deepEqual(result, {
    id: "heatmap",
    panelId: "heatmap-panel",
    pascalName: "Heatmap",
    camelName: "heatmap",
  })
})

test("deriveNames derives id, panelId, pascalName, camelName from a hyphenated name", () => {
  const result = deriveNames("sensor-heatmap")
  assert.deepEqual(result, {
    id: "sensor-heatmap",
    panelId: "sensor-heatmap-panel",
    pascalName: "SensorHeatmap",
    camelName: "sensorHeatmap",
  })
})

test("deriveNames throws for an invalid name (delegates to validatePluginName)", () => {
  assert.throws(() => deriveNames("Bad_Name"), /Invalid plugin name/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: FAIL — `Cannot find module '../create-plugin.mjs'` (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `scripts/create-plugin.mjs`:

```javascript
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export function validatePluginName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Plugin name is required, e.g. `pnpm create-plugin sensor-heatmap`")
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}" — must match ${NAME_PATTERN} ` +
        `(lowercase letters, digits, hyphens; must start with a letter). Example: sensor-heatmap`,
    )
  }
}

function toPascalCase(kebabName) {
  return kebabName
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("")
}

function toCamelCase(kebabName) {
  const pascal = toPascalCase(kebabName)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

export function deriveNames(name) {
  validatePluginName(name)
  return {
    id: name,
    panelId: `${name}-panel`,
    pascalName: toPascalCase(name),
    camelName: toCamelCase(name),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs scripts/__tests__/create-plugin.test.mjs
git commit -m "feat(scripts): add create-plugin name validation and derivation"
```

---

### Task 2: Template renderers

**Files:**
- Modify: `scripts/create-plugin.mjs`
- Modify: `scripts/__tests__/create-plugin.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/create-plugin.test.mjs`:

```javascript
import { renderPanelTemplate, renderTestTemplate } from "../create-plugin.mjs"

test("renderPanelTemplate includes the derived names and useStoreSlice/SDFPlugin wiring", () => {
  const source = renderPanelTemplate({
    pascalName: "SensorHeatmap",
    camelName: "sensorHeatmap",
    id: "sensor-heatmap",
    panelId: "sensor-heatmap-panel",
  })
  assert.match(source, /export function SensorHeatmapPanel\(props: PluginProps\)/)
  assert.match(source, /props\.useStoreSlice\(\(s\) => s\)/)
  assert.match(source, /export const sensorHeatmapPlugin: SDFPlugin = \{/)
  assert.match(source, /id: "sensor-heatmap",/)
  assert.match(source, /id: "sensor-heatmap-panel",/)
  assert.match(source, /component: \(props\) => <SensorHeatmapPanel \{\.\.\.props\} \/>,/)
})

test("renderTestTemplate includes the derived names and a passing smoke assertion target", () => {
  const source = renderTestTemplate({ pascalName: "SensorHeatmap", camelName: "sensorHeatmap" })
  assert.match(source, /import \{ SensorHeatmapPanel \} from "\.\.\/sensorHeatmapPlugin"/)
  assert.match(source, /describe\("SensorHeatmapPanel", \(\) => \{/)
  assert.match(source, /데이터 대기 중/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: FAIL — `renderPanelTemplate is not a function` / `renderTestTemplate is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/create-plugin.mjs`:

```javascript
export function renderPanelTemplate({ pascalName, camelName, id, panelId }) {
  return `"use client"
import type { PluginProps, SDFPlugin } from "@sdf/types"

export function ${pascalName}Panel(props: PluginProps) {
  // TODO: select the slice of host state your plugin needs, e.g.:
  //   props.useStoreSlice((s) => (s as YourStoreShape).machines["M1"])
  const state = props.useStoreSlice((s) => s)

  if (!state) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-600 text-center">
        ${pascalName} 데이터 대기 중...
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <p className="text-xs text-gray-400 mb-1">플러그인: ${pascalName}</p>
      {/* TODO: render your plugin's UI here. Prefer packages/ui primitives
          per CONTRIBUTING.md's plugin guidance. */}
    </div>
  )
}

export const ${camelName}Plugin: SDFPlugin = {
  id: "${id}",
  name: "${pascalName}",
  version: "0.1.0",
  activate: (ctx) => {
    ctx.registerPanel({
      id: "${panelId}",
      label: "${pascalName}",
      component: (props) => <${pascalName}Panel {...props} />,
    })
  },
}
`
}

export function renderTestTemplate({ pascalName, camelName }) {
  return `import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { createPluginProps } from "@sdf/plugin-runtime"
import { ${pascalName}Panel } from "../${camelName}Plugin"

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

describe("${pascalName}Panel", () => {
  it("renders the placeholder empty state", () => {
    const props = createPluginProps(makeFakeBindings(null))
    render(<${pascalName}Panel {...props} />)
    expect(screen.getByText(/데이터 대기 중/)).toBeInTheDocument()
  })
})
`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs scripts/__tests__/create-plugin.test.mjs
git commit -m "feat(scripts): add create-plugin panel and test template renderers"
```

---

### Task 3: `plugins.ts` import + array insertion

**Files:**
- Modify: `scripts/create-plugin.mjs`
- Modify: `scripts/__tests__/create-plugin.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/create-plugin.test.mjs`:

```javascript
import { insertPluginImportAndEntry } from "../create-plugin.mjs"

const SAMPLE_PLUGINS_TS = `import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin]
`

test("insertPluginImportAndEntry adds the import after the last @/plugins import and appends to the array", () => {
  const result = insertPluginImportAndEntry(SAMPLE_PLUGINS_TS, {
    camelName: "sensorHeatmap",
    id: "sensor-heatmap",
  })
  assert.match(result, /import \{ alertLogPlugin \} from "@\/plugins\/alertLogPlugin"\nimport \{ sensorHeatmapPlugin \} from "@\/plugins\/sensorHeatmapPlugin"/)
  assert.match(
    result,
    /export const installedPlugins: SDFPlugin\[\] = \[sensorChartPlugin, alertLogPlugin, sensorHeatmapPlugin\]/,
  )
})

test("insertPluginImportAndEntry works when installedPlugins starts empty", () => {
  const emptySource = `import type { SDFPlugin } from "@sdf/types"

export const installedPlugins: SDFPlugin[] = []
`
  const result = insertPluginImportAndEntry(emptySource, {
    camelName: "sensorHeatmap",
    id: "sensor-heatmap",
  })
  assert.match(result, /import \{ sensorHeatmapPlugin \} from "@\/plugins\/sensorHeatmapPlugin"/)
  assert.match(result, /export const installedPlugins: SDFPlugin\[\] = \[sensorHeatmapPlugin\]/)
})

test("insertPluginImportAndEntry throws when the installedPlugins array can't be found", () => {
  assert.throws(
    () => insertPluginImportAndEntry("export const somethingElse = []", { camelName: "x", id: "x" }),
    /Could not find/,
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: FAIL — `insertPluginImportAndEntry is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/create-plugin.mjs`:

```javascript
const IMPORT_LINE_PATTERN = /^import \{ \w+ \} from "@\/plugins\/[^"]+"$/gm
const TYPE_IMPORT_PATTERN = /^import type \{ SDFPlugin \} from "@sdf\/types"$/m
const INSTALLED_PLUGINS_ARRAY_PATTERN = /(export const installedPlugins: SDFPlugin\[\] = \[)([^\]]*)(\])/

export function insertPluginImportAndEntry(source, { camelName, id }) {
  const importLine = `import { ${camelName}Plugin } from "@/plugins/${camelName}Plugin"`

  const pluginImportMatches = [...source.matchAll(IMPORT_LINE_PATTERN)]
  let withImport
  if (pluginImportMatches.length > 0) {
    const last = pluginImportMatches[pluginImportMatches.length - 1]
    const insertAt = last.index + last[0].length
    withImport = `${source.slice(0, insertAt)}\n${importLine}${source.slice(insertAt)}`
  } else {
    const typeMatch = source.match(TYPE_IMPORT_PATTERN)
    if (!typeMatch) {
      throw new Error(
        `Could not find an import anchor in plugins.ts to insert "${importLine}" after. ` +
          `Expected either an existing "@/plugins/*" import or the "@sdf/types" import.`,
      )
    }
    const insertAt = typeMatch.index + typeMatch[0].length
    withImport = `${source.slice(0, insertAt)}\n${importLine}${source.slice(insertAt)}`
  }

  const arrayMatch = withImport.match(INSTALLED_PLUGINS_ARRAY_PATTERN)
  if (!arrayMatch) {
    throw new Error(
      'Could not find "export const installedPlugins: SDFPlugin[] = [...]" in plugins.ts ' +
        "to append the new plugin to.",
    )
  }
  const [fullMatch, prefix, body, suffix] = arrayMatch
  const trimmedBody = body.trim()
  const newBody = trimmedBody.length === 0 ? `${camelName}Plugin` : `${trimmedBody}, ${camelName}Plugin`

  return (
    withImport.slice(0, arrayMatch.index) +
    prefix +
    newBody +
    suffix +
    withImport.slice(arrayMatch.index + fullMatch.length)
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs scripts/__tests__/create-plugin.test.mjs
git commit -m "feat(scripts): add plugins.ts import/array insertion for create-plugin"
```

---

### Task 4: Existing panel id collection (collision detection)

**Files:**
- Modify: `scripts/create-plugin.mjs`
- Modify: `scripts/__tests__/create-plugin.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/create-plugin.test.mjs`:

```javascript
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { collectExistingPanelIds } from "../create-plugin.mjs"

async function makeFixtureHostTwinDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "create-plugin-test-"))
  await mkdir(path.join(dir, "plugins"), { recursive: true })
  await mkdir(path.join(dir, "lib"), { recursive: true })
  await writeFile(
    path.join(dir, "lib", "plugins.ts"),
    `import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"

export const installedPlugins: SDFPlugin[] = [sensorChartPlugin]
`,
    "utf8",
  )
  await writeFile(
    path.join(dir, "plugins", "sensorChartPlugin.tsx"),
    `export const sensorChartPlugin = {
  id: "example-sensor-chart",
  activate: (ctx) => {
    ctx.registerPanel({ id: "example-sensor-chart-panel", label: "x", component: () => null })
  },
}
`,
    "utf8",
  )
  return dir
}

test("collectExistingPanelIds includes built-in ids and ids scanned from installed plugin files", async () => {
  const dir = await makeFixtureHostTwinDir()
  try {
    const ids = await collectExistingPanelIds(dir)
    assert.ok(ids.has("canvas"))
    assert.ok(ids.has("charts"))
    assert.ok(ids.has("agent"))
    assert.ok(ids.has("detail"))
    assert.ok(ids.has("rules"))
    assert.ok(ids.has("mes"))
    assert.ok(ids.has("example-sensor-chart-panel"))
    assert.equal(ids.has("some-other-panel"), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: FAIL — `collectExistingPanelIds is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/create-plugin.mjs` (add `import { readFile } from "node:fs/promises"` and `import path from "node:path"` at the top of the file if not already present from a later task — for this task, add them now):

```javascript
import { readFile } from "node:fs/promises"
import path from "node:path"

// Keep in sync with apps/host-twin/store/factoryStore.ts's BUILT_IN_PANEL_IDS.
// Note: since every generated panel id carries a "-panel" suffix (see deriveNames),
// it can never literally equal one of these bare built-in ids — this set is
// defense in depth (e.g. if the suffix convention changes later), not something
// runCreatePlugin's tests can exercise directly today.
const BUILT_IN_PANEL_IDS = new Set(["canvas", "charts", "agent", "detail", "rules", "mes"])

const PLUGIN_IMPORT_MODULE_PATTERN = /from ["']@\/plugins\/([^"']+)["']/g
const REGISTER_PANEL_ID_PATTERN = /registerPanel\(\{\s*id:\s*["']([^"']+)["']/g

export async function collectExistingPanelIds(hostTwinDir) {
  const ids = new Set(BUILT_IN_PANEL_IDS)
  const pluginsTsFile = path.join(hostTwinDir, "lib", "plugins.ts")
  const source = await readFile(pluginsTsFile, "utf8")

  const moduleNames = [...source.matchAll(PLUGIN_IMPORT_MODULE_PATTERN)].map((match) => match[1])
  for (const moduleName of moduleNames) {
    const filePath = path.join(hostTwinDir, "plugins", `${moduleName}.tsx`)
    const fileSource = await readFile(filePath, "utf8")
    for (const match of fileSource.matchAll(REGISTER_PANEL_ID_PATTERN)) {
      ids.add(match[1])
    }
  }
  return ids
}
```

Note: place the two new `import` lines at the very top of `scripts/create-plugin.mjs`, above `const NAME_PATTERN = ...`. ESM requires imports at module top level.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs scripts/__tests__/create-plugin.test.mjs
git commit -m "feat(scripts): add existing-panel-id collision detection for create-plugin"
```

---

### Task 5: Orchestration (`runCreatePlugin`)

**Files:**
- Modify: `scripts/create-plugin.mjs`
- Modify: `scripts/__tests__/create-plugin.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/create-plugin.test.mjs`:

```javascript
import { readFile as readFileForAssertions } from "node:fs/promises"
import { runCreatePlugin } from "../create-plugin.mjs"

test("runCreatePlugin creates the panel file, test file, and updates plugins.ts", async () => {
  const dir = await makeFixtureHostTwinDir()
  try {
    const result = await runCreatePlugin({ name: "sensor-heatmap", hostTwinDir: dir })

    const panelSource = await readFileForAssertions(result.pluginFile, "utf8")
    assert.match(panelSource, /export const sensorHeatmapPlugin: SDFPlugin = \{/)

    const testSource = await readFileForAssertions(result.testFile, "utf8")
    assert.match(testSource, /describe\("SensorHeatmapPanel", \(\) => \{/)

    const pluginsTsSource = await readFileForAssertions(result.pluginsTsFile, "utf8")
    assert.match(pluginsTsSource, /import \{ sensorHeatmapPlugin \} from "@\/plugins\/sensorHeatmapPlugin"/)
    assert.match(
      pluginsTsSource,
      /export const installedPlugins: SDFPlugin\[\] = \[sensorChartPlugin, sensorHeatmapPlugin\]/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runCreatePlugin refuses to overwrite an existing plugin file", async () => {
  const dir = await makeFixtureHostTwinDir()
  try {
    await runCreatePlugin({ name: "sensor-heatmap", hostTwinDir: dir })
    await assert.rejects(
      () => runCreatePlugin({ name: "sensor-heatmap", hostTwinDir: dir }),
      /already exists/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runCreatePlugin refuses a name that collides with an existing panel id", async () => {
  const dir = await makeFixtureHostTwinDir()
  try {
    // "example-sensor-chart" derives panelId "example-sensor-chart-panel",
    // which the fixture's sensorChartPlugin.tsx already registers.
    await assert.rejects(
      () => runCreatePlugin({ name: "example-sensor-chart", hostTwinDir: dir }),
      /already registered/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: FAIL — `runCreatePlugin is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/create-plugin.mjs` (add `mkdir, writeFile, access` to the existing `node:fs/promises` import):

Change:
```javascript
import { readFile } from "node:fs/promises"
```
to:
```javascript
import { readFile, writeFile, mkdir, access } from "node:fs/promises"
```

Then append:

```javascript
async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function runCreatePlugin({ name, hostTwinDir }) {
  const { id, panelId, pascalName, camelName } = deriveNames(name)

  const pluginsDir = path.join(hostTwinDir, "plugins")
  const testsDir = path.join(pluginsDir, "__tests__")
  const pluginFile = path.join(pluginsDir, `${camelName}Plugin.tsx`)
  const testFile = path.join(testsDir, `${camelName}Plugin.test.tsx`)
  const pluginsTsFile = path.join(hostTwinDir, "lib", "plugins.ts")

  if (await fileExists(pluginFile)) {
    throw new Error(`${pluginFile} already exists`)
  }
  if (await fileExists(testFile)) {
    throw new Error(`${testFile} already exists`)
  }

  const existingIds = await collectExistingPanelIds(hostTwinDir)
  if (existingIds.has(panelId)) {
    throw new Error(
      `Panel id "${panelId}" is already registered (built-in panel or an installed plugin). ` +
        "Choose a different name.",
    )
  }

  const pluginsTsSource = await readFile(pluginsTsFile, "utf8")
  const updatedPluginsTsSource = insertPluginImportAndEntry(pluginsTsSource, { camelName, id })

  await mkdir(pluginsDir, { recursive: true })
  await mkdir(testsDir, { recursive: true })
  await writeFile(pluginFile, renderPanelTemplate({ pascalName, camelName, id, panelId }), "utf8")
  await writeFile(testFile, renderTestTemplate({ pascalName, camelName }), "utf8")
  await writeFile(pluginsTsFile, updatedPluginsTsSource, "utf8")

  return { pluginFile, testFile, pluginsTsFile }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (18 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs scripts/__tests__/create-plugin.test.mjs
git commit -m "feat(scripts): add runCreatePlugin orchestration with validation gates"
```

---

### Task 6: CLI entry point + root script wiring

**Files:**
- Modify: `scripts/create-plugin.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the CLI entry point**

Add `import { fileURLToPath } from "node:url"` to the top of `scripts/create-plugin.mjs` alongside the other imports (final import block should be):

```javascript
import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
```

Append to the end of `scripts/create-plugin.mjs`:

```javascript
async function main() {
  const name = process.argv[2]
  const hostTwinDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "host-twin")

  try {
    const result = await runCreatePlugin({ name, hostTwinDir })
    console.log(`Created:
  ${result.pluginFile}
  ${result.testFile}
Updated:
  ${result.pluginsTsFile}

Next steps:
  1. Fill in the TODOs in ${path.basename(result.pluginFile)}
  2. pnpm --filter @sdf/host-twin test -- ${path.basename(result.testFile)}
`)
  } catch (err) {
    console.error(`create-plugin failed: ${err.message}`)
    process.exitCode = 1
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  await main()
}
```

This runs `main()` only when the file is executed directly (`node scripts/create-plugin.mjs ...`), not when imported by the test file — the test file never triggers the CLI path since `process.argv[1]` there points at the test runner, not `create-plugin.mjs`.

- [ ] **Step 2: Wire up the root package.json script**

In `package.json`, find:
```json
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
```

Replace with:
```json
  "scripts": {
    "build": "turbo run build",
    "create-plugin": "node scripts/create-plugin.mjs",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "test:create-plugin": "node --test scripts/__tests__/create-plugin.test.mjs",
    "typecheck": "turbo run typecheck"
  },
```

- [ ] **Step 3: Verify the unit test suite still passes via the new root script**

Run: `pnpm test:create-plugin`
Expected: PASS (18 tests)

- [ ] **Step 4: Manual end-to-end verification against the real repo**

Run: `pnpm create-plugin demo-scaffold-check`
Expected output includes `Created:` followed by the two new file paths and `Updated:` followed by `apps/host-twin/lib/plugins.ts`.

Then verify the real toolchain accepts the generated code:
```bash
pnpm --filter @sdf/host-twin typecheck
pnpm --filter @sdf/host-twin test -- demoScaffoldCheckPlugin.test.tsx
```
Expected: both PASS (typecheck clean, 1 test passing).

Then **roll back this manual smoke check** so it doesn't ship as a permanent demo plugin:
```bash
git checkout -- apps/host-twin/lib/plugins.ts
rm apps/host-twin/plugins/demoScaffoldCheckPlugin.tsx
rm apps/host-twin/plugins/__tests__/demoScaffoldCheckPlugin.test.tsx
```
Confirm cleanup: `git status --short` should show no changes.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-plugin.mjs package.json
git commit -m "feat(scripts): add create-plugin CLI entry point and pnpm create-plugin script"
```

---

### Task 7: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification suite**

Run: `node --test scripts/__tests__/create-plugin.test.mjs`
Expected: PASS (18 tests)

Run: `pnpm typecheck`
Expected: PASS for every package (this task touches no package source, only `scripts/` and root `package.json`, so this should be unaffected)

Run: `pnpm --filter '!@sdf/backend-sim' test`
Expected: PASS — same counts as before this plan (`@sdf/plugin-runtime` 22, `@sdf/host-twin` 56) — this plan added no new package tests, only script tests run separately via `node --test`.

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: If any step fails, fix before proceeding**

Do not consider this plan complete until every command above passes cleanly.

---

## Self-Review Notes

- **Spec coverage:** §2 (plain Node ESM script, no new dependency) → Task 1-6's implementation choices. §3 (input & name derivation) → Task 1. §4 (generated files) → Task 2 (templates) + Task 5 (orchestration writes them). §5 (auto-registration) → Task 3. §6 (validation & error handling, in order: name format, file collision, id collision) → Task 1 (name format, enforced via `deriveNames` inside `runCreatePlugin`), Task 5 (file collision checks before id collision check — matches the spec's stated order), Task 4 (id collision detection). §7 (testing plan) → Task 1/2/3/4 unit tests + Task 5's integration tests (happy path, file collision, id collision from an installed plugin) + Task 6's real end-to-end manual check. Built-in id collision is covered directly at the `collectExistingPanelIds` unit level in Task 4 (asserts the built-in ids are present in the returned set) rather than as a `runCreatePlugin` integration test — the forced `-panel` suffix on every generated id makes a literal collision with a bare built-in id (`"charts"`, etc.) structurally unreachable through `runCreatePlugin` itself, so no integration test can exercise that path without contradicting the suffix convention. §8 (non-goals: backend template, Storybook, npm publish, interactive prompts, AST transforms, Inspector) → none of these appear anywhere in this plan, confirmed absent. §9 (dependencies) → this plan builds only on already-merged Phase 0/2 code (`PluginProps`, `SDFPlugin`, `createPluginProps`, the real `plugins.ts` shape), all verified present on `main` before writing this plan.
- **Type consistency verified:** `deriveNames`'s returned shape (`{ id, panelId, pascalName, camelName }`, Task 1) is threaded unchanged through `renderPanelTemplate`/`renderTestTemplate` (Task 2, same four keys), `insertPluginImportAndEntry` (Task 3, uses `camelName`/`id`), `collectExistingPanelIds` (Task 4, produces the `Set<string>` that `runCreatePlugin` checks `panelId` against), and `runCreatePlugin` (Task 5, destructures all four from `deriveNames` and passes them through consistently). The built-in panel id set (`canvas`, `charts`, `agent`, `detail`, `rules`, `mes`) in Task 4 was copied verbatim from the real `apps/host-twin/store/factoryStore.ts`'s `BUILT_IN_PANEL_IDS`, confirmed by reading that file directly rather than from the design spec's memory of it.
- **No placeholders:** every step has complete, runnable code; no `TBD`/"add validation"/"similar to Task N" shortcuts. The `TODO` comments that appear are intentional — they're generated *output* for a future plugin author to fill in, not gaps in this plan.
- **Real-repo grounding:** the exact current content of `apps/host-twin/lib/plugins.ts`, `apps/host-twin/plugins/alertLogPlugin.tsx`, and `apps/host-twin/store/factoryStore.ts`'s `BUILT_IN_PANEL_IDS` were read from `main` (post Phase 2 merge) before writing this plan, not assumed from the design spec — Task 3's fixture text matches the real file byte-for-byte at the time of writing.
