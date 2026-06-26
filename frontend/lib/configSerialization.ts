/**
 * configSerialization.ts
 *
 * URL 직렬화 방어 로직 (Headless / 순수 함수 레이어).
 *
 * useConfigSync 훅에서 분리하여 단위 테스트 가능하도록 구성.
 * lz-string 압축 결과가 브라우저/웹서버 URI 길이 제한을 초과하면
 * URL 동기화를 차단하고 localStorage 폴백으로 우회한다.
 */

/** URL 쿼리스트링 안전 기준선 (자) — 대부분의 브라우저/서버 한계의 보수적 하한 */
export const URL_SAFE_LENGTH = 4000

/** localStorage 폴백 키 */
export const LOCAL_STORAGE_KEY = "sdf-config-fallback"

export interface LengthValidation {
  safe: boolean
  length: number
  limit: number
}

/** 압축 결과물이 URL 길이 제한 안에 있는지 검사 */
export function validateCompressedLength(
  compressed: string,
  limit: number = URL_SAFE_LENGTH,
): LengthValidation {
  return { safe: compressed.length <= limit, length: compressed.length, limit }
}

/**
 * 직렬화 동기화 전략 결정 — 순수 함수.
 * 압축 길이에 따라 URL 동기화 가능 여부와 폴백 필요 여부를 반환한다.
 */
export type SyncStrategy =
  | { mode: "url"; compressed: string }
  | { mode: "localStorage"; length: number; limit: number }

export function decideSyncStrategy(
  compressed: string,
  limit: number = URL_SAFE_LENGTH,
): SyncStrategy {
  const { safe, length } = validateCompressedLength(compressed, limit)
  if (safe) return { mode: "url", compressed }
  return { mode: "localStorage", length, limit }
}

/** localStorage에 설정 JSON 저장 (브라우저 환경에서만 동작) */
export function saveToLocalStorage(json: string): boolean {
  try {
    if (typeof localStorage === "undefined") return false
    localStorage.setItem(LOCAL_STORAGE_KEY, json)
    return true
  } catch {
    return false
  }
}

/** localStorage에서 설정 JSON 복원 */
export function loadFromLocalStorage(): string | null {
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage.getItem(LOCAL_STORAGE_KEY)
  } catch {
    return null
  }
}
