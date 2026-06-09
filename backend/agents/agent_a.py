import asyncio
import json
import re
import time
from dataclasses import dataclass
from anthropic import AsyncAnthropic

@dataclass
class AnomalyReport:
    severity: str           # "low" | "medium" | "high" | "unknown"
    classification: str
    affected_components: list[str]
    confidence: float
    fallback: bool = False

def parse_agent_a_response(text: str) -> AnomalyReport:
    match = re.search(r'\{[^{}]+\}', text, re.DOTALL)
    if not match:
        return AnomalyReport(severity="unknown", classification="parse_error", affected_components=[], confidence=0.0, fallback=True)
    try:
        data = json.loads(match.group())
        return AnomalyReport(
            severity=data.get("severity", "unknown"),
            classification=data.get("classification", "unknown"),
            affected_components=data.get("affected_components", []),
            confidence=float(data.get("confidence", 0.0)),
        )
    except Exception:
        return AnomalyReport(severity="unknown", classification="parse_error", affected_components=[], confidence=0.0, fallback=True)

async def run_agent_a(machine_id: str, sensor_history: list[dict], client: AsyncAnthropic) -> AnomalyReport:
    history_str = json.dumps(sensor_history[-30:], separators=(",", ":"))
    prompt = f"""You are a factory equipment diagnostics expert.

Machine ID: {machine_id}
Sensor readings (last 30 ticks, each: {{ts, vibration_hz, temperature_c, current_a}}):
{history_str}

Analyze the sensor data and identify the anomaly. Return ONLY valid JSON with no other text:
{{"severity": "low"|"medium"|"high", "classification": "<fault type>", "affected_components": ["<component>"], "confidence": <0.0-1.0>}}"""

    try:
        async with asyncio.timeout(60):
            print(f"\n[Agent A] REQUEST machine={machine_id}\n{prompt}\n")
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text
            print(f"[Agent A] RESPONSE\n{raw}\n")
            return parse_agent_a_response(raw)
    except Exception:
        return AnomalyReport(severity="unknown", classification="timeout", affected_components=[], confidence=0.0, fallback=True)
