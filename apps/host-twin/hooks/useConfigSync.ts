"use client"

import { useEffect, useCallback } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import type { CameraState } from "@sdf/types"
import {
  URL_SAFE_LENGTH,
  decideSyncStrategy,
  saveToLocalStorage,
  loadFromLocalStorage,
} from "@/lib/configSerialization"

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

export function useConfigSync() {
  const importConfig = useFactoryStore((s) => s.importConfig)
  const exportConfigJSON = useFactoryStore((s) => s.exportConfig)

  const syncToURL = useCallback(async () => {
    if (typeof window === "undefined") return
    const lz = await getLZString()
    const json = exportConfigJSON()
    const compressed = lz.compressToEncodedURIComponent(json)
    const strategy = decideSyncStrategy(compressed)

    if (strategy.mode === "url") {
      const url = new URL(window.location.href)
      url.searchParams.set("config", strategy.compressed)
      window.history.replaceState(null, "", url.toString())
      return
    }

    // URL 길이 초과 → localStorage 폴백 + URL 파라미터 제거
    saveToLocalStorage(json)
    const url = new URL(window.location.href)
    url.searchParams.delete("config")
    window.history.replaceState(null, "", url.toString())

    useFactoryStore.getState().addToast({
      type: "warning",
      title: "설정 URL 초과",
      body: `설정 크기(${strategy.length.toLocaleString()}자)가 URL 안전 기준(${URL_SAFE_LENGTH.toLocaleString()}자)을 초과하여 브라우저 저장소에 자동 저장되었습니다.`,
    })
  }, [exportConfigJSON])

  const applyURLConfig = useCallback(async () => {
    if (typeof window === "undefined") return false
    const url = new URL(window.location.href)
    const param = url.searchParams.get("config")

    // 1차: URL 파라미터에서 복원
    if (param) {
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
    }

    // 2차: localStorage 폴백에서 복원
    const fallback = loadFromLocalStorage()
    if (fallback) {
      try {
        importConfig(fallback)
        useFactoryStore.getState().addToast({
          type: "success",
          title: "설정 복원",
          body: "브라우저 저장소에서 이전 설정을 복원했습니다.",
        })
        return true
      } catch {
        console.error("[useConfigSync] localStorage 설정 복원 실패")
        return false
      }
    }

    return false
  }, [importConfig])

  const exportToFile = useCallback(async () => {
    const json = exportConfigJSON()
    // 파일 내보내기 시에도 URL/localStorage 동기화 시도
    await syncToURL()

    const blob = new Blob([json], { type: "application/json" })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = blobUrl
    a.download = `sdf-config-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(blobUrl)
  }, [exportConfigJSON, syncToURL])

  const importFromFile = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,application/json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      importConfig(text)
      await syncToURL()
    }
    input.click()
  }, [importConfig, syncToURL])

  const captureAndSyncCamera = useCallback(async (camera: CameraState) => {
    useFactoryStore.getState().captureCamera(camera)
    await syncToURL()
  }, [syncToURL])

  useEffect(() => {
    applyURLConfig().then((restored) => {
      if (restored) {
        console.log("[useConfigSync] 설정 복원 완료")
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
