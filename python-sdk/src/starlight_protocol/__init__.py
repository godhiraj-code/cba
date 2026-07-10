"""
Starlight Protocol Python SDK

A Python package for building Sentinels that connect to the Starlight Protocol Hub.
"""

from .core import PROTOCOL_VERSION, ProtocolError, Sentinel, Starlight
from .sentinel_base import SentinelBase

__version__ = "5.0.0a1"
__all__ = [
    "PROTOCOL_VERSION",
    "ProtocolError",
    "Sentinel",
    "SentinelBase",
    "Starlight",
]
