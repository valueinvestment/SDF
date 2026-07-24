import { readFile, writeFile, mkdir, access } from "node:fs/promises"
import path from "node:path"

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
  const trimmedBody = body.trim().replace(/,\s*$/, "")
  const newBody = trimmedBody.length === 0 ? `${camelName}Plugin` : `${trimmedBody}, ${camelName}Plugin`

  return (
    withImport.slice(0, arrayMatch.index) +
    prefix +
    newBody +
    suffix +
    withImport.slice(arrayMatch.index + fullMatch.length)
  )
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

// Keep in sync with apps/host-twin/store/factoryStore.ts's BUILT_IN_PANEL_IDS.
// Note: since every generated panel id carries a "-panel" suffix (see deriveNames),
// it can never literally equal one of these bare built-in ids — this set is
// defense in depth (e.g. if the suffix convention changes later), not something
// runCreatePlugin's tests can exercise directly today.
const BUILT_IN_PANEL_IDS = new Set(["canvas", "charts", "agent", "detail", "rules", "mes"])

const PLUGIN_IMPORT_MODULE_PATTERN = /from ["']@\/plugins\/([^"']+)["']/g
// Assumes `id` is the first property in an inline `registerPanel({ id: "...", ... })`
// call, matching this generator's own template output and both existing example
// plugins' style — a hand-written plugin using a different property order or a
// variable-based panel config would not be detected by this scan.
const REGISTER_PANEL_ID_PATTERN = /registerPanel\(\{\s*id:\s*["']([^"']+)["']/g

export async function collectExistingPanelIds(hostTwinDir) {
  const ids = new Set(BUILT_IN_PANEL_IDS)
  const pluginsTsFile = path.join(hostTwinDir, "lib", "plugins.ts")
  const source = await readFile(pluginsTsFile, "utf8")

  const moduleNames = [...source.matchAll(PLUGIN_IMPORT_MODULE_PATTERN)].map((match) => match[1])
  for (const moduleName of moduleNames) {
    const filePath = path.join(hostTwinDir, "plugins", `${moduleName}.tsx`)
    let fileSource
    try {
      fileSource = await readFile(filePath, "utf8")
    } catch (err) {
      throw new Error(
        `plugins.ts imports "@/plugins/${moduleName}" but ${filePath} could not be read ` +
          `(${err.code === "ENOENT" ? "file not found" : err.message}). ` +
          "Check for a stale or commented-out import in plugins.ts.",
      )
    }
    for (const match of fileSource.matchAll(REGISTER_PANEL_ID_PATTERN)) {
      ids.add(match[1])
    }
  }
  return ids
}

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
