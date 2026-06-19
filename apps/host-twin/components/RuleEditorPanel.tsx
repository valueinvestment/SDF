"use client"
/**
 * RuleEditorPanel
 *
 * 동적 룰 CRUD UI.
 * - 조건 수식 입력 + 실시간 유효성 검사
 * - 액션: overlay_color | alert_popup | play_sound | webhook_post
 * - Webhook URL 및 채널 타입 입력 (Slack / Discord)
 */

import { useState } from "react"
import { useFactoryStore } from "@/store/factoryStore"
import { validateFormula } from "@sdf/core-sdk"
import type { RuleAction, RuleActionType } from "@sdf/types"

const ACTION_LABELS: Record<RuleActionType, string> = {
  overlay_color: "3D 색상 오버레이",
  alert_popup: "경고 팝업",
  play_sound: "경고음 재생",
  webhook_post: "Webhook 전송",
}

export function RuleEditorPanel() {
  const rules = useFactoryStore((s) => s.rules)
  const addRule = useFactoryStore((s) => s.addRule)
  const removeRule = useFactoryStore((s) => s.removeRule)
  const updateRule = useFactoryStore((s) => s.updateRule)

  const [name, setName] = useState("")
  const [condition, setCondition] = useState("")
  const [condError, setCondError] = useState<string | null>(null)
  const [selectedActions, setSelectedActions] = useState<RuleActionType[]>(["alert_popup"])
  const [overlayColor, setOverlayColor] = useState("#ef4444")
  const [soundFreq, setSoundFreq] = useState("880")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookChannel, setWebhookChannel] = useState<"slack" | "discord">("slack")
  const [cooldownSec, setCooldownSec] = useState("10")

  const handleConditionChange = (v: string) => {
    setCondition(v)
    if (!v.trim()) { setCondError(null); return }
    // 비교 연산자가 있으면 한쪽만 파싱
    const checkExpr = v.replace(/[><=!]+.*/g, "").trim() || v
    const result = validateFormula(checkExpr.trim() || "0")
    setCondError(result.valid ? null : (result.error ?? "유효하지 않은 조건"))
  }

  const toggleAction = (type: RuleActionType) => {
    setSelectedActions((prev) =>
      prev.includes(type) ? prev.filter((a) => a !== type) : [...prev, type]
    )
  }

  const buildActions = (): RuleAction[] => {
    const actions: RuleAction[] = []
    if (selectedActions.includes("overlay_color")) actions.push({ type: "overlay_color", color: overlayColor })
    if (selectedActions.includes("alert_popup")) actions.push({ type: "alert_popup" })
    if (selectedActions.includes("play_sound")) actions.push({ type: "play_sound", soundFrequency: parseInt(soundFreq) || 880 })
    if (selectedActions.includes("webhook_post") && webhookUrl.trim()) {
      actions.push({ type: "webhook_post", webhookUrl: webhookUrl.trim(), webhookChannel })
    }
    return actions
  }

  const handleAdd = () => {
    if (!name.trim() || !condition.trim()) return
    addRule({
      name: name.trim(),
      condition: condition.trim(),
      machineId: null,
      actions: buildActions(),
      cooldownMs: (parseInt(cooldownSec) || 10) * 1000,
      enabled: true,
    })
    setName("")
    setCondition("")
    setCondError(null)
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-orange-400 uppercase tracking-widest font-semibold">
        동적 룰 엔진
      </p>

      {/* 기존 룰 목록 */}
      {rules.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {rules.map((rule) => (
            <div key={rule.id} className={`rounded-lg border px-2 py-1.5 text-xs ${
              rule.enabled ? "border-orange-800/60 bg-orange-950/20" : "border-gray-700 bg-gray-900/40"
            }`}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                  className={`w-3 h-3 rounded-sm border flex-shrink-0 ${
                    rule.enabled ? "bg-orange-500 border-orange-400" : "border-gray-600"
                  }`}
                />
                <span className="text-gray-200 flex-1 font-medium truncate">{rule.name}</span>
                <button
                  onClick={() => removeRule(rule.id)}
                  className="text-gray-600 hover:text-red-400 flex-shrink-0"
                >
                  ✕
                </button>
              </div>
              <p className="text-gray-500 font-mono mt-0.5 pl-5 truncate">{rule.condition}</p>
              <div className="flex gap-1 mt-1 pl-5 flex-wrap">
                {rule.actions.map((a, i) => (
                  <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-gray-800 text-gray-400">
                    {ACTION_LABELS[a.type]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 신규 룰 추가 폼 */}
      <div className="bg-gray-800/60 rounded-lg p-2 space-y-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="룰 이름 (e.g. 고온 경보)"
          className="w-full bg-gray-900 text-xs text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-orange-600 outline-none"
        />
        <div>
          <input
            value={condition}
            onChange={(e) => handleConditionChange(e.target.value)}
            placeholder="temperature > 100"
            className={`w-full bg-gray-900 text-xs font-mono rounded px-2 py-1 border outline-none ${
              condError ? "border-red-600 text-red-300" : "border-gray-700 text-gray-200 focus:border-orange-600"
            }`}
          />
          {condError && <p className="text-[10px] text-red-400 mt-0.5">{condError}</p>}
        </div>

        {/* 액션 선택 */}
        <div className="space-y-1">
          {(Object.keys(ACTION_LABELS) as RuleActionType[]).map((type) => (
            <div key={type}>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedActions.includes(type)}
                  onChange={() => toggleAction(type)}
                  className="accent-orange-500 w-3 h-3"
                />
                <span className="text-xs text-gray-300">{ACTION_LABELS[type]}</span>
              </label>

              {type === "overlay_color" && selectedActions.includes("overlay_color") && (
                <div className="flex items-center gap-1.5 pl-5 mt-0.5">
                  <span className="text-[10px] text-gray-500">색상</span>
                  <input
                    type="color"
                    value={overlayColor}
                    onChange={(e) => setOverlayColor(e.target.value)}
                    className="w-6 h-5 rounded cursor-pointer border-none bg-transparent"
                  />
                  <span className="text-[10px] font-mono text-gray-500">{overlayColor}</span>
                </div>
              )}

              {type === "play_sound" && selectedActions.includes("play_sound") && (
                <div className="flex items-center gap-1.5 pl-5 mt-0.5">
                  <span className="text-[10px] text-gray-500">주파수(Hz)</span>
                  <input
                    value={soundFreq}
                    onChange={(e) => setSoundFreq(e.target.value)}
                    className="w-16 bg-gray-900 text-[10px] font-mono text-gray-300 rounded px-1 border border-gray-700 outline-none"
                  />
                </div>
              )}

              {type === "webhook_post" && selectedActions.includes("webhook_post") && (
                <div className="pl-5 mt-0.5 space-y-0.5">
                  <select
                    value={webhookChannel}
                    onChange={(e) => setWebhookChannel(e.target.value as "slack" | "discord")}
                    className="bg-gray-900 text-[10px] text-gray-300 rounded border border-gray-700 px-1 py-0.5"
                  >
                    <option value="slack">Slack</option>
                    <option value="discord">Discord</option>
                  </select>
                  <input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/..."
                    className="w-full bg-gray-900 text-[10px] font-mono text-gray-300 rounded px-2 py-1 border border-gray-700 outline-none"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">쿨다운(초)</span>
          <input
            value={cooldownSec}
            onChange={(e) => setCooldownSec(e.target.value)}
            className="w-14 bg-gray-900 text-[10px] font-mono text-gray-300 rounded px-1 border border-gray-700 outline-none"
          />
        </div>

        <button
          onClick={handleAdd}
          disabled={!!condError || !name.trim() || !condition.trim()}
          className="w-full text-xs py-1 rounded bg-orange-900/50 text-orange-400 border border-orange-800 hover:bg-orange-900/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          룰 추가
        </button>
      </div>
    </div>
  )
}
