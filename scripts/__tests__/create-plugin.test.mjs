import { test } from "node:test"
import assert from "node:assert/strict"
import { validatePluginName, deriveNames, renderPanelTemplate, renderTestTemplate } from "../create-plugin.mjs"

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
