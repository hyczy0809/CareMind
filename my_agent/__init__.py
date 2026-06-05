"""CareMind agent package.

Keep package import lightweight so shared schema modules can be imported by
business APIs and tests without requiring the full ADK runtime.
"""

from importlib import import_module
from typing import Any


def __getattr__(name: str) -> Any:
    if name == "agent":
        return import_module(f"{__name__}.agent")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
