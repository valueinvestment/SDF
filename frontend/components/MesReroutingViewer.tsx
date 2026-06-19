"use client"
/**
 * MesReroutingViewer
 *
 * MES 폐루프 공정 이관 실시간 모니터링 위젯.
 * - reroutingLog에서 이관 이벤트를 구독
 * - "rerouting" 상태: 네온풍 애니메이션 + 스케줄 바 이동
 * - "completed": 초록 완료 표시
 * - 수동 이관 트리거 버튼 포함
 */

import { useFactoryStore } from "@/store/factoryStore"
import type { ReroutingEvent } from "@/lib/types"

function ReroutingCard({ event }: { event: ReroutingEvent }) {
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const fromLabel = placedEntities.find((e) => e.id === event.fromMachineId)?.label ?? event.fromMachineId
  const toLabel = placedEntities.find((e) => e.id === event.toMachineId)?.label ?? event.toMachineId

  const isActive = event.status === "rerouting"

  return (
    <div className={`rounded-lg border p-2.5 transition-all duration-500 ${
      isActive
        ? "border-fuchsia-600/70 bg-fuchsia-950/20"
        : event.status === "completed"
        ? "border-emerald-800/50 bg-emerald-950/10"
        : "border-red-800/50 bg-red-950/10"
    }`}
      style={isActive ? {
        boxShadow: "0 0 10px rgba(217,70,239,0.25), inset 0 0 6px rgba(217,70,239,0.08)",
      } : undefined}
    >
      {/* 헤더 상태 */}
      <div className="flex items-center gap-2 mb-2">
        {isActive ? (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-fuchsia-500" />
          </span>
        ) : event.status === "completed" ? (
          <span className="text-emerald-400 text-xs">✓</span>
        ) : (
          <span className="text-red-400 text-xs">✕</span>
        )}
        <span className={`text-[10px] font-bold uppercase tracking-widest ${
          isActive ? "text-fuchsia-300" : event.status === "completed" ? "text-emerald-400" : "text-red-400"
        }`}>
          {isActive ? "생산 라인 긴급 우회 배정 중..." : event.status === "completed" ? "이관 완료" : "이관 실패"}
        </span>
        <span className="ml-auto text-[9px] text-gray-600 font-mono">
          {new Date(event.ts).toLocaleTimeString("ko-KR")}
        </span>
      </div>

      {/* WorkOrder 정보 */}
      <div className="text-[10px] text-gray-400 mb-2 grid grid-cols-2 gap-x-2">
        <div><span className="text-gray-600">지시번호</span> <span className="text-gray-300 font-mono">{event.workOrder.id}</span></div>
        <div><span className="text-gray-600">자재</span> <span className="text-gray-300">{event.workOrder.materialName}</span></div>
      </div>

      {/* 스케줄 바 이동 애니메이션 */}
      <div className="flex items-center gap-2 text-[10px]">
        {/* 출발 노드 */}
        <div className="flex-shrink-0 text-center">
          <div className={`rounded px-1.5 py-0.5 border font-medium ${
            isActive ? "border-fuchsia-700 text-fuchsia-300 bg-fuchsia-900/30" : "border-gray-700 text-gray-400"
          }`}>
            {fromLabel}
          </div>
          <div className="text-gray-600 mt-0.5">장애</div>
        </div>

        {/* 이동 애니메이션 트랙 */}
        <div className="flex-1 relative h-4 flex items-center">
          <div className={`h-0.5 w-full rounded ${isActive ? "bg-fuchsia-800" : "bg-gray-700"}`} />
          {/* 이동하는 패킷 */}
          <div className={`absolute h-3 w-3 rounded-full border-2 transition-all duration-[2000ms] ${
            isActive
              ? "left-0 border-fuchsia-400 bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)]"
              : event.status === "completed"
              ? "left-full -translate-x-full border-emerald-400 bg-emerald-500"
              : "left-1/2 -translate-x-1/2 border-red-400 bg-red-500"
          }`}
            style={isActive ? { animation: "rerouteSlide 2s ease-in-out forwards" } : undefined}
          />
        </div>

        {/* 도착 노드 */}
        <div className="flex-shrink-0 text-center">
          <div className={`rounded px-1.5 py-0.5 border font-medium ${
            event.status === "completed"
              ? "border-emerald-700 text-emerald-300 bg-emerald-900/30"
              : isActive
              ? "border-fuchsia-700/40 text-fuchsia-400/60"
              : "border-gray-700 text-gray-400"
          }`}>
            {toLabel}
          </div>
          <div className="text-gray-600 mt-0.5">인계</div>
        </div>
      </div>
    </div>
  )
}

export function MesReroutingViewer() {
  const reroutingLog = useFactoryStore((s) => s.reroutingLog)
  const rerouteWorkOrder = useFactoryStore((s) => s.rerouteWorkOrder)
  const placedEntities = useFactoryStore((s) => s.placedEntities)
  const workOrders = useFactoryStore((s) => s.workOrders)

  const machines = placedEntities.filter((e) => e.type !== "robot")
  const activeRerouting = reroutingLog.filter((e) => e.status === "rerouting")

  return (
    <div className="bg-gray-900/60 rounded-xl p-3 space-y-2">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <p className="text-[10px] text-fuchsia-400 uppercase tracking-widest font-semibold flex-1">
          MES 작업 지시 실시간 모니터링
        </p>
        {activeRerouting.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-900/50 text-fuchsia-300 border border-fuchsia-700">
            {activeRerouting.length}건 진행중
          </span>
        )}
      </div>

      {/* 수동 이관 트리거 */}
      {machines.length >= 2 && (
        <div className="bg-gray-800/40 rounded-lg p-2 space-y-1">
          <p className="text-[10px] text-gray-500">수동 긴급 이관 트리거</p>
          <div className="flex flex-wrap gap-1">
            {machines.map((m) => (
              <button
                key={m.id}
                onClick={() => rerouteWorkOrder(m.id)}
                disabled={!workOrders[m.id]}
                className="text-[10px] px-2 py-0.5 rounded border border-fuchsia-800 text-fuchsia-400 hover:bg-fuchsia-900/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {m.label} 이관
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 이관 로그 */}
      {reroutingLog.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-2">이관 이력 없음</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {reroutingLog.map((event) => (
            <ReroutingCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* 스케줄 바 애니메이션 keyframe */}
      <style>{`
        @keyframes rerouteSlide {
          0%   { left: 0%; }
          100% { left: calc(100% - 12px); }
        }
      `}</style>
    </div>
  )
}
