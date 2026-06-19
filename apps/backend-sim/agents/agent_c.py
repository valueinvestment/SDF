import asyncio
import json
import re
from anthropic import AsyncAnthropic
from agents.agent_a import AnomalyReport
from agents.agent_b import DispatchPlan

def parse_agent_c_response(text: str) -> dict:
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Could not compute. Defaulting to scheduled maintenance.",
            "fallback": True,
        }
    try:
        data = json.loads(match.group())
        return {
            "recommendation": data.get("recommendation", "scheduled_maintenance"),
            "rice_scores": data.get("rice_scores", {}),
            "rationale": data.get("rationale", ""),
            "fallback": False,
        }
    except Exception:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Parse error. Defaulting to scheduled maintenance.",
            "fallback": True,
        }

async def run_agent_c(
    machine_id: str,
    report: AnomalyReport,
    dispatch: DispatchPlan,
    client: AsyncAnthropic,
) -> dict:
    prompt = f"""You are a factory operations decision analyst.

Faulted machine: {machine_id}
Fault classification: {report.classification} (severity: {report.severity}, confidence: {report.confidence})
Repair robot dispatched: {dispatch.robotId}, ETA: {dispatch.eta_seconds:.0f} seconds

Evaluate three action options using RICE scoring (score = reach * impact * confidence / effort):
1. immediate_repair — dispatch robot now, halt machine
2. scheduled_maintenance — queue for next maintenance window
3. temporary_bypass — reroute production, defer repair

Return ONLY valid JSON (no extra text):
{{
  "recommendation": "<option_key>",
  "rice_scores": {{
    "immediate":  {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}},
    "scheduled":  {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}},
    "bypass":     {{"reach": <1-10>, "impact": <1-10>, "confidence": <0-1>, "effort": <1-10>, "score": <float>}}
  }},
  "rationale": "<2-3 sentences>"
}}"""

    try:
        async with asyncio.timeout(60):
            print(f"\n[Agent C] REQUEST machine={machine_id}\n{prompt}\n")
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text
            print(f"[Agent C] RESPONSE\n{raw}\n")
            return parse_agent_c_response(raw)
    except Exception:
        return {
            "recommendation": "scheduled_maintenance",
            "rice_scores": {},
            "rationale": "Agent timeout. Defaulting to scheduled maintenance.",
            "fallback": True,
        }
