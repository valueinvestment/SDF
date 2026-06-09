"use client"
import { useFactoryStore } from "@/store/factoryStore"
import type { Toast } from "@/lib/types"

const STYLES: Record<Toast["type"], { bar: string; icon: string; title: string }> = {
  warning: { bar: "border-yellow-500 bg-gray-900",  icon: "⚠",  title: "text-yellow-400" },
  success: { bar: "border-green-500 bg-gray-900",   icon: "✓",  title: "text-green-400"  },
  error:   { bar: "border-red-500 bg-gray-900",     icon: "✕",  title: "text-red-400"    },
}

export function ToastContainer() {
  const toasts = useFactoryStore((s) => s.toasts)
  const dismiss = useFactoryStore((s) => s.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => {
        const s = STYLES[t.type]
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg border shadow-xl min-w-72 max-w-sm ${s.bar}`}
          >
            <span className={`text-base mt-0.5 ${s.title}`}>{s.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${s.title}`}>{t.title}</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{t.body}</p>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-gray-600 hover:text-gray-300 text-xs mt-0.5 flex-shrink-0"
            >✕</button>
          </div>
        )
      })}
    </div>
  )
}
