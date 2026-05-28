"use client"
import { useFactoryStore } from "@/store/factoryStore"

const PATH_TYPE_LABEL: Record<string, string> = {
  idle_patrol: "순찰 중",
  dispatch: "파견 중",
  returning: "복귀 중",
}
const PATH_TYPE_COLOR: Record<string, string> = {
  idle_patrol: "text-green-400",
  dispatch: "text-yellow-400",
  returning: "text-blue-400",
}

export function RobotDetailPanel({ robotId }: { robotId: string }) {
  const path = useFactoryStore((s) => s.robotPaths[robotId])
  const dispatch = useFactoryStore((s) => s.dispatchCommand)
  const isDispatched = dispatch?.robotId === robotId

  return (
    <div className="bg-gray-900 rounded-xl p-4 w-64 space-y-3">
      <div>
        <p className="font-semibold text-gray-100">{robotId}</p>
        <p className={`text-xs mt-0.5 ${isDispatched ? "text-yellow-400" : "text-green-400"}`}>
          {isDispatched ? "⚡ 파견 중" : "● 대기 중"}
        </p>
      </div>

      {path && (
        <>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">상태</span>
              <span className={PATH_TYPE_COLOR[path.pathType] ?? "text-gray-300"}>
                {PATH_TYPE_LABEL[path.pathType] ?? path.pathType}
              </span>
            </div>
            {path.targetEntityId && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">목적지</span>
                <span className="text-gray-300">{path.targetEntityId}</span>
              </div>
            )}
            {path.eta > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">ETA</span>
                <span className="text-gray-300">{path.eta.toFixed(0)}초</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">현재 위치</span>
              <span className="text-gray-300 font-mono">
                ({path.currentPos[0].toFixed(1)}, {path.currentPos[1].toFixed(1)})
              </span>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">추천 경로</p>
            <div className="bg-gray-800 rounded p-2 space-y-0.5 max-h-28 overflow-y-auto">
              {path.recommendedPath.map(([x, z], i) => (
                <p key={i} className="text-xs font-mono text-gray-400">
                  {i === 0 ? "▶ " : `${i}. `}({x.toFixed(1)}, {z.toFixed(1)})
                </p>
              ))}
            </div>
          </div>
        </>
      )}

      {!path && (
        <p className="text-xs text-gray-500 animate-pulse">경로 데이터 로딩 중...</p>
      )}
    </div>
  )
}
