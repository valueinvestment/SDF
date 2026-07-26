from dataclasses import dataclass


@dataclass
class PluginErrorEntry:
    message: str
    ts: float
