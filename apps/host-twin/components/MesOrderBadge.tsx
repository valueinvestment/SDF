"use client"
/**
 * MesOrderBadge
 *
 * 기계 상세 패널 상단에 렌더링되는 MES 생산 지시 정보 현황판.
 * - ISA-95 기반 WorkOrder 정보 표시
 * - 우선순위별 배지 색상 (S: 빨강, A: 주황, B: 파랑)
 * - 생산 진척도 프로그레스 바
 * - 마감일 D-Day 표시
 */

import { useFactoryStore } from "@/store/factoryStore"
import type { WorkOrderPriority } from "@sdf/types"

interface Props {
  machineId: string
}

const PRIORITY_STYLES: Record<WorkOrderPriority, { label: string; bg: string; text: string; border: string }> = {
  S: { label: "S급", bg: "bg-red-900/30",    text: "text-red-400",    border: "border-red-700" },
  A: { label: "A급", bg: "bg-orange-900/30", text: "text-orange-400", border: "border-orange-700" },
  B: { label: "B급", bg: "bg-blue-900/30",   text: "text-blue-400",   border: "border-blue-700" },
}

function getDDay(dueDateStr: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDateStr)
  due.setHours(0, 0, 0, 0)
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return "D-Day"
  if (diff > 0) return `D-${diff}`
  return `D+${Math.abs(diff)}`
}

function ProgressBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(1, target)) * 100))
  const color = pct >= 90 ? "bg-green-500" : pct >= 50 ? "bg-blue-500" : "bg-gray-500"
  return (
    <div className="w-full mt-1">
      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
        <span>{Math.floor(current)} / {target} 개</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function MesOrderBadge({ machineId }: Props) {
  const workOrder = useFactoryStore((s) => s.workOrders[machineId])
  const queue = useFactoryStore((s) => s.workOrderQueues[machineId] ?? [])

  if (!workOrder) return null

  const priority = PRIORITY_STYLES[workOrder.priority]
  const dday = getDDay(workOrder.dueDate)
  const ddayColor = dday === "D-Day"
    ? "text-red-400 font-bold"
    : dday.startsWith("D+")
    ? "text-red-500"
    : parseInt(dday.slice(2)) <= 2
    ? "text-orange-400"
    : "text-gray-400"

  return (
    <div className={`rounded-lg border ${priority.border} ${priority.bg} p-3 mb-3`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">
            MES 생산 지시
          </span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${priority.border} ${priority.text} ${priority.bg}`}>
            {priority.label}
          </span>
        </div>
        <span className={`text-xs font-mono ${ddayColor}`}>{dday}</span>
      </div>

      {/* 작업 지시 정보 */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <div>
          <span className="text-gray-500">지시번호</span>
          <span className="ml-1 text-gray-200 font-mono">{workOrder.id}</span>
        </div>
        <div>
          <span className="text-gray-500">마감일</span>
          <span className="ml-1 text-gray-200">{workOrder.dueDate}</span>
        </div>
        <div className="col-span-2">
          <span className="text-gray-500">자재명</span>
          <span className="ml-1 text-gray-100 font-medium">{workOrder.materialName}</span>
        </div>
      </div>

      {/* 생산 진척도 */}
      <ProgressBar current={workOrder.currentQuantity} target={workOrder.targetQuantity} />

      {/* 대기 큐 */}
      {queue.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">대기 작업</span>
          <div className="flex gap-1 mt-1 flex-wrap">
            {queue.map((wo) => (
              <span
                key={wo.id}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[wo.priority].border} ${PRIORITY_STYLES[wo.priority].text} ${PRIORITY_STYLES[wo.priority].bg}`}
              >
                {wo.id} · {wo.materialName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
