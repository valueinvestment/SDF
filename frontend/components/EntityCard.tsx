import type { EntityType } from "@/lib/types"

interface EntityCardProps {
  type: EntityType
  icon: string
  label: string
  count: number
  max: number
  disabled: boolean
  onSelect: () => void
  className?: string
  renderBadge?: (count: number, max: number) => React.ReactNode
}

export function EntityCard({
  icon,
  label,
  count,
  max,
  disabled,
  onSelect,
  className = "",
  renderBadge,
}: EntityCardProps) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={[
        "flex flex-col items-center gap-2 rounded-xl p-4 border transition-colors",
        disabled
          ? "border-gray-700 bg-gray-800 text-gray-600 cursor-not-allowed"
          : "border-gray-600 bg-gray-800 text-gray-200 hover:border-blue-500 hover:bg-gray-700 cursor-pointer",
        className,
      ].join(" ")}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      {renderBadge ? (
        renderBadge(count, max)
      ) : (
        <span className={`text-xs ${disabled ? "text-gray-600" : "text-gray-400"}`}>
          {count} / {max}
        </span>
      )}
    </button>
  )
}
