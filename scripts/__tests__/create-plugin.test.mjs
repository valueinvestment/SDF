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
