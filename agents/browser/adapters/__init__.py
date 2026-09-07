"""Site adapters package for DEX Browser Automation."""
from adapters.base_adapter import AdapterFallbackException, SiteAdapter
from adapters.registry import AdapterRegistry

__all__ = ["SiteAdapter", "AdapterFallbackException", "AdapterRegistry"]
