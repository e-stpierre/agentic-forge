"""Provider module for AI CLI abstraction."""

from typing import Type

from agentic_core.providers.base import CLIProvider, InvocationResult, ProviderCapabilities
from agentic_core.providers.claude import ClaudeProvider
from agentic_core.providers.cursor import CursorProvider
from agentic_core.providers.mock import MockProvider

# Provider registry
PROVIDERS: dict[str, Type[CLIProvider]] = {
    "claude": ClaudeProvider,
    "cursor": CursorProvider,
    "mock": MockProvider,
}


def register_provider(name: str):
    """Decorator to register a custom provider.

    Usage:
        @register_provider("custom")
        class CustomProvider(CLIProvider):
            ...
    """

    def decorator(cls: Type[CLIProvider]):
        PROVIDERS[name] = cls
        return cls

    return decorator


def get_provider(name: str, **kwargs) -> CLIProvider:
    """Get a provider instance by name.

    Args:
        name: Provider name (claude, cursor, mock)
        **kwargs: Additional arguments passed to provider constructor

    Returns:
        Initialized provider instance

    Raises:
        ValueError: If provider name is not registered
    """
    if name not in PROVIDERS:
        available = ", ".join(sorted(PROVIDERS.keys()))
        raise ValueError(f"Unknown provider: {name}. Available: {available}")
    return PROVIDERS[name](**kwargs)


def list_providers() -> list[str]:
    """Get list of registered provider names."""
    return sorted(PROVIDERS.keys())


__all__ = [
    "CLIProvider",
    "InvocationResult",
    "ProviderCapabilities",
    "ClaudeProvider",
    "CursorProvider",
    "MockProvider",
    "PROVIDERS",
    "register_provider",
    "get_provider",
    "list_providers",
]
