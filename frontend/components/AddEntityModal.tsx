"use client"
import { Dialog } from "@headlessui/react"
import { useAddEntityModal, MAX_PER_TYPE } from "@/hooks/useAddEntityModal"
import { EntityCard } from "@/components/EntityCard"

interface Props {
  onClose: () => void
}

export function AddEntityModal({ onClose }: Props) {
  const { typeMeta, countOf, canAdd, select } = useAddEntityModal()

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />

      {/* Panel */}
      <div className="fixed inset-0 flex items-center justify-center">
        <Dialog.Panel className="bg-gray-900 rounded-2xl p-6 w-80 shadow-2xl border border-gray-700">
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

          <div className="grid grid-cols-2 gap-3">
            {typeMeta.map(({ type, icon, korLabel }) => (
              <EntityCard
                key={type}
                icon={icon}
                label={korLabel}
                count={countOf(type)}
                max={MAX_PER_TYPE}
                disabled={!canAdd(type)}
                onSelect={() => select(type, onClose)}
              />
            ))}
          </div>

          <p className="text-gray-500 text-xs text-center mt-4">
            카드를 클릭하면 배치 모드로 전환됩니다
          </p>
        </Dialog.Panel>
      </div>
    </Dialog>
  )
}
