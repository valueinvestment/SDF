"use client"
/**
 * FormulaEditor
 *
 * 커스텀 계산 지표(ComputedMetric) 생성/관리 UI.
 * - 수식 입력 → formulaEngine.validateFormula()로 실시간 유효성 검사
 * - 생성된 지표는 SensorChart에 추가 시리즈로 바인딩됨
 */

import { useRef, useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { validateFormula } from "@/lib/formulaEngine"
import type { ComputedMetric } from "@/lib/types"

const DEFAULT_COLORS = ["#06b6d4", "#84cc16", "#f43f5e", "#a78bfa", "#fbbf24"]

function metricsEqual(a: ComputedMetric[], b: ComputedMetric[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].formula !== b[i].formula || a[i].color !== b[i].color || a[i].name !== b[i].name) return false
  }
  return true
}

interface Props {
  machineId: string
  label?: string
}

export function FormulaEditor({ machineId, label }: Props) {
  const prevRef = useRef<ComputedMetric[]>([])
  const metrics = useFactoryStore((s) => {
    const filtered = s.computedMetrics.filter((m) => m.machineId === null || m.machineId === machineId)
    if (metricsEqual(prevRef.current, filtered)) return prevRef.current
    prevRef.current = filtered
    return filtered
  })
  const addComputedMetric = useFactoryStore((s) => s.addComputedMetric)
  const removeComputedMetric = useFactoryStore((s) => s.removeComputedMetric)

  const [name, setName] = useState("")
  const [formula, setFormula] = useState("")
  const [color, setColor] = useState(DEFAULT_COLORS[0])
  const [error, setError] = useState<string | null>(null)

  const handleFormulaChange = (v: string) => {
    setFormula(v)
    if (!v.trim()) { setError(null); return }
    const result = validateFormula(v)
    setError(result.valid ? null : (result.error ?? "유효하지 않은 수식"))
  }

  const handleAdd = () => {
    if (!name.trim() || !formula.trim()) return
    const check = validateFormula(formula)
    if (!check.valid) { setError(check.error ?? "수식 오류"); return }
    addComputedMetric({ name: name.trim(), formula: formula.trim(), color, machineId })
    setName("")
    setFormula("")
    setError(null)
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-semibold">
        커스텀 지표 수식 — {label ?? machineId}
      </p>

      {/* 기존 지표 목록 */}
      {metrics.length > 0 && (
        <div className="space-y-1">
          {metrics.map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.color }} />
              <span className="text-gray-200 flex-1 truncate">{m.name}</span>
              <span className="text-gray-500 font-mono truncate max-w-[100px]">{m.formula}</span>
              <button
                onClick={() => removeComputedMetric(m.id)}
                className="text-gray-600 hover:text-red-400 ml-1 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 신규 지표 추가 폼 */}
      <div className="bg-gray-800/60 rounded-lg p-2 space-y-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="지표 이름 (e.g. 열-진동 지수)"
          className="w-full bg-gray-900 text-xs text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-cyan-600 outline-none"
        />
        <div className="flex gap-1.5">
          <input
            value={formula}
            onChange={(e) => handleFormulaChange(e.target.value)}
            placeholder="(vibration + temperature) / 2"
            className={`flex-1 bg-gray-900 text-xs font-mono rounded px-2 py-1 border outline-none ${
              error ? "border-red-600 text-red-300" : "border-gray-700 text-gray-200 focus:border-cyan-600"
            }`}
          />
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="bg-gray-900 text-xs text-gray-300 rounded border border-gray-700 px-1"
          >
            {DEFAULT_COLORS.map((c) => (
              <option key={c} value={c} style={{ background: c }}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        <p className="text-[10px] text-gray-600">
          변수: vibration, temperature, current · 함수: abs(), sqrt(), min(a,b), max(a,b)
        </p>
        <button
          onClick={handleAdd}
          disabled={!!error || !name.trim() || !formula.trim()}
          className="w-full text-xs py-1 rounded bg-cyan-900/50 text-cyan-400 border border-cyan-800 hover:bg-cyan-900/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          지표 추가
        </button>
      </div>
    </div>
  )
}
