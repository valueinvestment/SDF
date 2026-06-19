import pytest
from agents.agent_a import parse_agent_a_response

def test_parse_valid_response():
    raw = '{"severity": "high", "classification": "bearing_fault", "affected_components": ["spindle"], "confidence": 0.92}'
    result = parse_agent_a_response(raw)
    assert result.severity == "high"
    assert result.confidence == 0.92

def test_parse_response_with_surrounding_text():
    raw = 'Here is my analysis:\n{"severity": "medium", "classification": "overheating", "affected_components": ["motor"], "confidence": 0.75}\nEnd.'
    result = parse_agent_a_response(raw)
    assert result.severity == "medium"

def test_parse_invalid_returns_fallback():
    result = parse_agent_a_response("I cannot determine the issue.")
    assert result.severity == "unknown"
    assert result.confidence == 0.0

from agents.agent_b import parse_agent_b_response

def test_parse_agent_b_valid():
    raw = '{"robotId": "R2", "path": [[5,5],[7,5],[7,3]], "eta_seconds": 4.2, "reasoning": "nearest idle robot"}'
    result = parse_agent_b_response(raw)
    assert result.robotId == "R2"
    assert len(result.path) == 3

def test_parse_agent_b_fallback():
    result = parse_agent_b_response("cannot determine")
    assert result.robotId == "R1"
    assert result.fallback is True

from agents.agent_c import parse_agent_c_response

def test_parse_agent_c_valid():
    raw = '''{
      "recommendation": "immediate_repair",
      "rice_scores": {
        "immediate": {"reach": 8, "impact": 9, "confidence": 0.9, "effort": 3, "score": 24.0},
        "scheduled": {"reach": 8, "impact": 6, "confidence": 0.8, "effort": 2, "score": 19.2},
        "bypass":    {"reach": 4, "impact": 3, "confidence": 0.6, "effort": 1, "score": 7.2}
      },
      "rationale": "High severity fault requires immediate action."
    }'''
    result = parse_agent_c_response(raw)
    assert result["recommendation"] == "immediate_repair"
    assert "immediate" in result["rice_scores"]

def test_parse_agent_c_fallback():
    result = parse_agent_c_response("I cannot determine")
    assert result["recommendation"] == "scheduled_maintenance"
    assert result["fallback"] is True
