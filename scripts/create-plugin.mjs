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
