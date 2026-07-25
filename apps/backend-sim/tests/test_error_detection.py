from plugins.error_detection import detect_new_plugin_errors
from plugins.errors import PluginErrorEntry


def test_first_call_returns_all_existing_errors_as_new():
    all_errors = {"c1": [PluginErrorEntry(message="boom", ts=1.0)]}
    last_seen: dict[str, int] = {}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0] == {"source": "collector", "id": "c1", "message": "boom", "ts": 1.0}
    assert last_seen == {"c1": 1}


def test_second_call_returns_only_newly_added_errors():
    all_errors = {"c1": [PluginErrorEntry(message="first", ts=1.0)]}
    last_seen: dict[str, int] = {}
    detect_new_plugin_errors(all_errors, "collector", last_seen)  # prime last_seen
    all_errors["c1"].append(PluginErrorEntry(message="second", ts=2.0))
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0]["message"] == "second"


def test_ids_with_no_new_errors_are_ignored():
    all_errors = {"c1": [PluginErrorEntry(message="boom", ts=1.0)]}
    last_seen = {"c1": 1}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert events == []


def test_multiple_ids_tracked_independently():
    all_errors = {
        "c1": [PluginErrorEntry(message="a", ts=1.0)],
        "c2": [PluginErrorEntry(message="b", ts=2.0)],
    }
    last_seen = {"c1": 1}
    events = detect_new_plugin_errors(all_errors, "collector", last_seen)
    assert len(events) == 1
    assert events[0]["id"] == "c2"


def test_source_label_is_passed_through_unchanged():
    all_errors = {"s1": [PluginErrorEntry(message="boom", ts=1.0)]}
    events = detect_new_plugin_errors(all_errors, "pipeline_stage", {})
    assert events[0]["source"] == "pipeline_stage"
