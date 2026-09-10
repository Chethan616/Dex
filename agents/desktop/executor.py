"""
Backward-compatible re-export. The real implementation moved to computer.py
(Phase B of the vision-first migration) — see that file for what changed
(virtual-desktop coordinate clamping, unified screenshot saving). Kept here,
thin, until nothing imports the old name; then this file is deleted.
"""
from computer import Computer as Executor  # noqa: F401
