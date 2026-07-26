from plugins.errors import PluginErrorEntry


def detect_new_plugin_errors(
    all_errors: dict[str, list[PluginErrorEntry]],
    source: str,
    last_seen_counts: dict[str, int],
) -> list[dict]:
    """Compares each id's current error list against how many entries were seen
    last time, and returns only the newly-appended ones as plain dicts ready for
    `gateway.broadcast({"type": "plugin_error", "payload": event})`. Mutates
    `last_seen_counts` in place so the caller can reuse the same dict every tick.
    Assumes error lists are append-only (never truncated) between calls."""
    new_events: list[dict] = []
    for plugin_id, entries in all_errors.items():
        seen = last_seen_counts.get(plugin_id, 0)
        for entry in entries[seen:]:
            new_events.append({"source": source, "id": plugin_id, "message": entry.message, "ts": entry.ts})
        last_seen_counts[plugin_id] = len(entries)
    return new_events
