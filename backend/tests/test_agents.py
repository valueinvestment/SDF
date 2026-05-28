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
