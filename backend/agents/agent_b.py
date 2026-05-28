import asyncio
import json
import re
from dataclasses import dataclass, field
from anthropic import AsyncAnthropic
from simulator.sensor_simulator import MACHINE_POSITIONS, ROBOT_POSITIONS
from agents.agent_a import AnomalyReport

@dataclass
class DispatchPlan:
    robotId: str
    path: list[list[float]]
    eta_seconds: float
    reasoning: str = ""
    fallback: bool = False

def parse_agent_b_response(text: str) -> DispatchPlan:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)
    try:
        data = json.loads(match.group())
        return DispatchPlan(
            robotId=data["robotId"],
            path=data.get("path", []),
            eta_seconds=float(data.get("eta_seconds", 10.0)),
            reasoning=data.get("reasoning", ""),
        )
    except Exception:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)

async def run_agent_b(
    machine_id: str,
    report: AnomalyReport,
    robot_states: dict,
    client: AsyncAnthropic,
) -> DispatchPlan:
    machine_pos = MACHINE_POSITIONS[machine_id]
    idle_robots = [
        {"id": rid, "x": robot_states[rid]["x"], "y": robot_states[rid]["y"]}
        for rid in robot_states
        if robot_states[rid].get("status") == "idle"
    ] or [{"id": "R1", "x": 10, "y": 10}]

    prompt = f"""You are a factory floor robot dispatch system.

Factory grid: 20x20 units.
Faulted machine: {machine_id} at position {machine_pos}.
Anomaly: {report.classification} (severity: {report.severity})

Available idle robots:
{json.dumps(idle_robots, separators=(",", ":"))}

Select the nearest idle robot and compute a direct waypoint path (3-5 waypoints) to the machine.
Return ONLY valid JSON:
{{"robotId": "<id>", "path": [[x,y],...], "eta_seconds": <float>, "reasoning": "<brief>"}}"""

    try:
        async with asyncio.timeout(10):
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            return parse_agent_b_response(response.content[0].text)
    except Exception:
        return DispatchPlan(robotId="R1", path=[], eta_seconds=10.0, fallback=True)
