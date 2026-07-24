import { test } from "node:test"
import assert from "node:assert/strict"
import { validatePluginName, deriveNames, renderPanelTemplate, renderTestTemplate } from "../create-plugin.mjs"
import { insertPluginImportAndEntry } from "../create-plugin.mjs"

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
