import type { SDFPlugin } from "@sdf/types"
import { sensorChartPlugin } from "@/plugins/sensorChartPlugin"
import { alertLogPlugin } from "@/plugins/alertLogPlugin"
import { sessionRecorderPlugin } from "@/plugins/sessionRecorderPlugin"
import { demoControllerPlugin } from "@/plugins/demoControllerPlugin"

/**
 * Statically installed plugins. Add imported plugin objects to this array
 * to activate them at app boot. (Phase 4 will add a dynamic loader that
 * calls the same PluginRegistry.register() entry point at runtime.)
 */
export const installedPlugins: SDFPlugin[] = [
  sensorChartPlugin,
  alertLogPlugin,
  sessionRecorderPlugin,
  demoControllerPlugin,
]
