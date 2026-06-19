"use client"
import { useState } from "react"
import { Dialog } from "@headlessui/react"
import { useAddEntityModal, MAX_PER_TYPE } from "@/hooks/useAddEntityModal"
import { EntityCard } from "@/components/EntityCard"
import type { EntityType, EntityScale } from "@sdf/types"

interface Props {
  onClose: () => void
}

const SCALE_LABELS = ["가로(X)", "높이(Y)", "세로(Z)"] as const
const SCALE_KEYS = ["x", "y", "z"] as const

function ScaleSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-12">{label}</span>
      <input
        type="range"
        min={0.5}
        max={3.0}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500"
      />
      <span className="text-[10px] font-mono text-gray-300 w-8 text-right">
        {value.toFixed(1)}×
      </span>
    </div>
  )
}

export function AddEntityModal({ onClose }: Props) {
  const { typeMeta, countOf, canAdd, select } = useAddEntityModal()
  const [selectedType, setSelectedType] = useState<EntityType | null>(null)
  const [scale, setScale] = useState<EntityScale>({ x: 1, y: 1, z: 1 })

  const handleCardClick = (type: EntityType) => {
    if (!canAdd(type)) return
    setSelectedType((prev) => (prev === type ? null : type))
    setScale({ x: 1, y: 1, z: 1 })
  }

  const handleConfirm = () => {
    if (!selectedType) return
    select(selectedType, scale, onClose)
  }

  const updateScale = (axis: keyof EntityScale, value: number) => {
    setScale((prev) => ({ ...prev, [axis]: value }))
  }

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="bg-gray-900 rounded-2xl p-6 w-88 max-w-sm shadow-2xl border border-gray-700">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-white font-semibold text-base">
              장비 추가
            </Dialog.Title>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          {/* 타입 카드 선택 */}
          <div className="grid grid-cols-2 gap-3">
            {typeMeta.map(({ type, icon, korLabel }) => (
              <div
                key={type}
                onClick={() => handleCardClick(type)}
                className={`cursor-pointer rounded-xl border-2 transition-all ${
                  selectedType === type
                    ? "border-blue-500 bg-blue-900/20"
                    : "border-gray-700 hover:border-gray-600"
                } ${!canAdd(type) ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <EntityCard
                  icon={icon}
                  label={korLabel}
                  count={countOf(type)}
                  max={MAX_PER_TYPE}
                  disabled={!canAdd(type)}
                  onSelect={() => {}}
                />
              </div>
            ))}
          </div>

          {/* 스케일 슬라이더 (선택된 타입이 있을 때만) */}
          {selectedType && selectedType !== "robot" && (
            <div className="mt-4 bg-gray-800/60 rounded-xl p-3 space-y-2">
              <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold mb-2">
                크기 배율 설정
              </p>
              {SCALE_KEYS.map((axis, i) => (
                <ScaleSlider
                  key={axis}
                  label={SCALE_LABELS[i]}
                  value={scale[axis]}
                  onChange={(v) => updateScale(axis, v)}
                />
              ))}
              <p className="text-[10px] text-gray-600 mt-1">
                배치 후 편집 모드에서도 조정 가능합니다
              </p>
            </div>
          )}

          {/* 확인 버튼 */}
          {selectedType && (
            <button
              onClick={handleConfirm}
              className="mt-4 w-full py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
            >
              배치 시작
            </button>
          )}

          {!selectedType && (
            <p className="text-gray-500 text-xs text-center mt-4">
              카드를 클릭해 장비를 선택하세요
            </p>
          )}
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
