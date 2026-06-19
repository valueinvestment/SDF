"use client"
/**
 * useConfigSync
 *
 * DashboardConfig + placedEntities를 URL 쿼리스트링(?config=...)에
 * 압축 직렬화/역직렬화하여 동기화하는 훅.
 *
 * - lz-string의 compressToEncodedURIComponent / decompressFromEncodedURIComponent 사용
 * - 최초 로드 시 URL 파라미터가 있으면 자동 복원
 * - exportConfig(): JSON 파일 다운로드 + URL 동기화
 * - importConfig(): JSON 파일 업로드 파서
 * - syncToURL(): 현재 상태를 URL에 인코딩
 * - applyURLConfig(): URL에서 상태 복원
 */

import { useEffect, useCallback } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { DashboardConfig, PlacedEntity, CameraState } from "@/lib/types"

type LZAdapter = {
  compressToEncodedURIComponent: (s: string) => string
  decompressFromEncodedURIComponent: (s: string) => string | null
}

const FALLBACK_ADAPTER: LZAdapter = {
  compressToEncodedURIComponent: (s) => btoa(unescape(encodeURIComponent(s))),
  decompressFromEncodedURIComponent: (s) => {
    try { return decodeURIComponent(escape(atob(s))) } catch { return null }
  },
}

// lz-string은 선택적으로 로드 (서버 컴포넌트 호환)
let cachedLZ: LZAdapter | null = null

async function getLZString(): Promise<LZAdapter> {
  if (cachedLZ) return cachedLZ
  try {
    const mod = await import("lz-string")
    const lib = (mod.default ?? mod) as unknown as LZAdapter
    cachedLZ = lib
  } catch {
    console.warn("[useConfigSync] lz-string not available, using fallback Base64")
    cachedLZ = FALLBACK_ADAPTER
  }
  return cachedLZ
}

interface ConfigBundle {
  dashboardConfig: DashboardConfig
  placedEntities: PlacedEntity[]
}

export function useConfigSync() {
  const setDashboardConfig = useFactoryStore((s) => s.setDashboardConfig)
  const importConfig = useFactoryStore((s) => s.importConfig)
  const exportConfigJSON = useFactoryStore((s) => s.exportConfig)

  /** 현재 상태를 URL 쿼리스트링에 인코딩 */
  const syncToURL = useCallback(async () => {
    if (typeof window === "undefined") return
    const lz = await getLZString()
    const json = exportConfigJSON()
    const compressed = lz.compressToEncodedURIComponent(json)
    const url = new URL(window.location.href)
    url.searchParams.set("config", compressed)
    window.history.replaceState(null, "", url.toString())
  }, [exportConfigJSON])

  /** URL 파라미터에서 설정을 복원 */
  const applyURLConfig = useCallback(async () => {
    if (typeof window === "undefined") return false
    const url = new URL(window.location.href)
    const param = url.searchParams.get("config")
    if (!param) return false

    const lz = await getLZString()
    const json = lz.decompressFromEncodedURIComponent(param)
    if (!json) {
      console.error("[useConfigSync] URL 파라미터 압축 해제 실패")
      return false
    }
    try {
      importConfig(json)
      return true
    } catch {
      console.error("[useConfigSync] 설정 복원 실패")
      return false
    }
  }, [importConfig])

  /** JSON 파일로 내보내기 + URL 동기화 */
  const exportToFile = useCallback(async () => {
    const json = exportConfigJSON()
    await syncToURL()

    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `sdf-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [exportConfigJSON, syncToURL])

  /** JSON 파일에서 가져오기 */
  const importFromFile = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,application/json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      importConfig(text)
      // URL도 동기화
      await syncToURL()
    }
    input.click()
  }, [importConfig, syncToURL])

  /** Three.js 카메라 상태를 설정에 캡처 후 URL 동기화 */
  const captureAndSyncCamera = useCallback(async (camera: CameraState) => {
    useFactoryStore.getState().captureCamera(camera)
    await syncToURL()
  }, [syncToURL])

  // 최초 로드 시 URL 파라미터 복원
  useEffect(() => {
    applyURLConfig().then((restored) => {
      if (restored) {
        console.log("[useConfigSync] URL에서 대시보드 설정 복원 완료")
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    syncToURL,
    applyURLConfig,
    exportToFile,
    importFromFile,
    captureAndSyncCamera,
  }
}
