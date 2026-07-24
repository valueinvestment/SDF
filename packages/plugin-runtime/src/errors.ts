export class PluginPanelConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginPanelConflictError"
  }
}
