import { test } from "node:test"
import assert from "node:assert/strict"
import { validatePluginName, deriveNames, renderPanelTemplate, renderTestTemplate } from "../create-plugin.mjs"
import { insertPluginImportAndEntry } from "../create-plugin.mjs"
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { collectExistingPanelIds } from "../create-plugin.mjs"
import { readFile as readFileForAssertions } from "node:fs/promises"
import { runCreatePlugin } from "../create-plugin.mjs"

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

test("insertPluginImportAndEntry strips a trailing comma before appending", () => {
  const sourceWithTrailingComma = `import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"

export const installedPlugins: SDFPlugin[] = [sensorChartPlugin,]
`
  const result = insertPluginImportAndEntry(sourceWithTrailingComma, {
    camelName: "sensorHeatmap",
    id: "sensor-heatmap",
  })
  assert.match(
    result,
    /export const installedPlugins: SDFPlugin\[\] = \[sensorChartPlugin, sensorHeatmapPlugin\]/,
  )
})

test("insertPluginImportAndEntry throws when no import anchor can be found", () => {
  const sourceWithNoAnchors = `export const installedPlugins: SDFPlugin[] = []`
  assert.throws(
    () => insertPluginImportAndEntry(sourceWithNoAnchors, { camelName: "x", id: "x" }),
    /Could not find an import anchor/,
  )
})

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

test("collectExistingPanelIds scans multiple installed plugin files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "create-plugin-test-"))
  try {
    await mkdir(path.join(dir, "plugins"), { recursive: true })
    await mkdir(path.join(dir, "lib"), { recursive: true })
    await writeFile(
      path.join(dir, "lib", "plugins.ts"),
      `import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"

export const installedPlugins: SDFPlugin[] = [sensorChartPlugin, alertLogPlugin]
`,
      "utf8",
    )
    await writeFile(
      path.join(dir, "plugins", "sensorChartPlugin.tsx"),
      `export const sensorChartPlugin = {
  activate: (ctx) => {
    ctx.registerPanel({ id: "example-sensor-chart-panel", label: "x", component: () => null })
  },
}
`,
      "utf8",
    )
    await writeFile(
      path.join(dir, "plugins", "alertLogPlugin.tsx"),
      `export const alertLogPlugin = {
  activate: (ctx) => {
    ctx.registerPanel({ id: "example-alert-log-panel", label: "x", component: () => null })
  },
}
`,
      "utf8",
    )
    const ids = await collectExistingPanelIds(dir)
    assert.ok(ids.has("example-sensor-chart-panel"))
    assert.ok(ids.has("example-alert-log-panel"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("collectExistingPanelIds handles a plugin file with zero registerPanel calls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "create-plugin-test-"))
  try {
    await mkdir(path.join(dir, "plugins"), { recursive: true })
    await mkdir(path.join(dir, "lib"), { recursive: true })
    await writeFile(
      path.join(dir, "lib", "plugins.ts"),
      `import type { SDFPlugin } from "@sdf/types"
import { ruleOnlyPlugin } from "@/plugins/ruleOnlyPlugin"

export const installedPlugins: SDFPlugin[] = [ruleOnlyPlugin]
`,
      "utf8",
    )
    await writeFile(
      path.join(dir, "plugins", "ruleOnlyPlugin.tsx"),
      `export const ruleOnlyPlugin = {
  activate: (ctx) => {
    ctx.addRule({})
  },
}
`,
      "utf8",
    )
    const ids = await collectExistingPanelIds(dir)
    assert.ok(ids.has("canvas"))
    assert.equal(ids.has("undefined"), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("collectExistingPanelIds throws a clear error when an imported plugin file is missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "create-plugin-test-"))
  try {
    await mkdir(path.join(dir, "plugins"), { recursive: true })
    await mkdir(path.join(dir, "lib"), { recursive: true })
    await writeFile(
      path.join(dir, "lib", "plugins.ts"),
      `import type { SDFPlugin } from "@sdf/types"
import { ghostPlugin } from "@/plugins/ghostPlugin"

export const installedPlugins: SDFPlugin[] = [ghostPlugin]
`,
      "utf8",
    )
    await assert.rejects(() => collectExistingPanelIds(dir), /ghostPlugin.*could not be read|file not found/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("collectExistingPanelIds throws a clear error when hostTwinDir has no lib/plugins.ts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "create-plugin-test-"))
  try {
    await assert.rejects(() => collectExistingPanelIds(dir), /Could not read.*plugins\.ts|file not found/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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

test("runCreatePlugin rolls back the plugin file if the test file write fails", async () => {
  const dir = await makeFixtureHostTwinDir()
  try {
    // Simulate a stale test file left over with no matching plugin file.
    await mkdir(path.join(dir, "plugins", "__tests__"), { recursive: true })
    await writeFile(path.join(dir, "plugins", "__tests__", "sensorHeatmapPlugin.test.tsx"), "stale", "utf8")

    await assert.rejects(
      () => runCreatePlugin({ name: "sensor-heatmap", hostTwinDir: dir }),
      /already exists/,
    )

    const pluginFileStillExists = await access(path.join(dir, "plugins", "sensorHeatmapPlugin.tsx"))
      .then(() => true)
      .catch(() => false)
    assert.equal(pluginFileStillExists, false)
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
