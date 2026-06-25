"use client"
import { useState, useRef, type DragEvent } from "react"
import { Dialog } from "@headlessui/react"
import { useAddEntityModal, MAX_PER_TYPE } from "@/hooks/useAddEntityModal"
import { EntityCard } from "@/components/EntityCard"
import type { EntityType, EntityScale } from "@sdf/types"

interface Props {
  onClose: () => void
}

const SCALE_LABELS = ["가로(X)", "높이(Y)", "세로(Z)"] as const
const SCALE_KEYS = ["x", "y", "z"] as const
const ACCEPTED_EXTENSIONS = [".glb", ".gltf"]

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

function isValidModelFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export function AddEntityModal({ onClose }: Props) {
  const { typeMeta, countOf, canAdd, select } = useAddEntityModal()
  const [selectedType, setSelectedType] = useState<EntityType | null>(null)
  const [scale, setScale] = useState<EntityScale>({ x: 1, y: 1, z: 1 })

  // Custom 3D model state
  const [modelUrl, setModelUrl] = useState("")
  const [modelFile, setModelFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleCardClick = (type: EntityType) => {
    if (type !== "custom" && !canAdd(type)) return
    setSelectedType((prev) => (prev === type ? null : type))
    setScale({ x: 1, y: 1, z: 1 })
    setModelUrl("")
    setModelFile(null)
  }

  const handleConfirm = () => {
    if (!selectedType) return
    if (selectedType === "custom") {
      const url = modelFile ? URL.createObjectURL(modelFile) : modelUrl.trim()
      if (!url) return
      select(selectedType, scale, onClose, url)
      return
    }
    select(selectedType, scale, onClose)
  }

  const updateScale = (axis: keyof EntityScale, value: number) => {
    setScale((prev) => ({ ...prev, [axis]: value }))
  }

  const handleFileDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && isValidModelFile(file)) {
      setModelFile(file)
      setModelUrl("")
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && isValidModelFile(file)) {
      setModelFile(file)
      setModelUrl("")
    }
  }

  const hasCustomModel = selectedType === "custom" && (modelFile !== null || modelUrl.trim().length > 0)
  const canConfirm = selectedType !== null && (selectedType !== "custom" || hasCustomModel)

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="bg-gray-900 rounded-2xl p-6 w-96 max-w-md shadow-2xl border border-gray-700">
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
            {typeMeta.filter(m => m.type !== "custom").map(({ type, icon, korLabel }) => (
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

          {/* Custom 3D 모델 카드 (별도 행) */}
          <div
            onClick={() => handleCardClick("custom")}
            className={`mt-3 cursor-pointer rounded-xl border-2 transition-all ${
              selectedType === "custom"
                ? "border-emerald-500 bg-emerald-900/20"
                : "border-gray-700 hover:border-gray-600"
            }`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl">📦</span>
              <div className="flex-1">
                <p className="text-sm text-white font-medium">외부 3D 모델 (GLB/GLTF)</p>
                <p className="text-[10px] text-gray-500">파일 업로드 또는 URL 입력</p>
              </div>
              <span className="text-[10px] text-gray-500 font-mono">{countOf("custom")}개</span>
            </div>
          </div>

          {/* Custom 모델 입력 영역 */}
          {selectedType === "custom" && (
            <div className="mt-3 bg-gray-800/60 rounded-xl p-3 space-y-3">
              {/* 드래그 앤 드롭 영역 */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-emerald-400 bg-emerald-900/20"
                    : modelFile
                    ? "border-emerald-600 bg-emerald-900/10"
                    : "border-gray-600 hover:border-gray-500"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {modelFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-emerald-400 text-sm">✓</span>
                    <span className="text-xs text-emerald-300 truncate max-w-[200px]">{modelFile.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setModelFile(null) }}
                      className="text-gray-500 hover:text-red-400 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">GLB / GLTF 파일을 여기에 드래그</p>
                    <p className="text-[10px] text-gray-600 mt-1">또는 클릭하여 파일 선택</p>
                  </>
                )}
              </div>

              {/* URL 입력 */}
              {!modelFile && (
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">또는 외부 URL 입력</p>
                  <input
                    type="url"
                    value={modelUrl}
                    onChange={(e) => setModelUrl(e.target.value)}
                    placeholder="https://example.com/model.glb"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}

          {/* 스케일 슬라이더 */}
          {selectedType && selectedType !== "robot" && (
            <div className="mt-3 bg-gray-800/60 rounded-xl p-3 space-y-2">
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
            </div>
          )}

          {/* 확인 버튼 */}
          {canConfirm && (
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
