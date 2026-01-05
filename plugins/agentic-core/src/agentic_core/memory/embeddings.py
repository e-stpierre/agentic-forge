"""Embedding providers for semantic memory."""

import os
from abc import ABC, abstractmethod
from typing import Optional


class EmbeddingProvider(ABC):
    """Base class for embedding providers."""

    name: str = "base"
    dimensions: int = 384

    @abstractmethod
    def embed(self, text: str) -> list[float]:
        """Generate embedding for text.

        Args:
            text: Text to embed

        Returns:
            List of floats representing the embedding
        """
        pass

    @abstractmethod
    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts.

        Args:
            texts: List of texts to embed

        Returns:
            List of embeddings
        """
        pass


class LocalEmbeddingProvider(EmbeddingProvider):
    """Local embedding using sentence-transformers.

    Requires: pip install sentence-transformers
    """

    name = "sentence-transformers"
    dimensions = 384  # Default for all-MiniLM-L6-v2

    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        device: Optional[str] = None,
    ):
        """Initialize local embedding provider.

        Args:
            model_name: Name of the sentence-transformers model
            device: Device to run on (cuda, cpu, or None for auto)
        """
        self.model_name = model_name
        self.device = device
        self._model = None
        self._dimensions = None

    def _load_model(self):
        """Lazy load the model."""
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(self.model_name, device=self.device)
                # Get actual dimensions from model
                self._dimensions = self._model.get_sentence_embedding_dimension()
            except ImportError:
                raise ImportError(
                    "sentence-transformers is required for local embeddings. "
                    "Install with: pip install sentence-transformers"
                )

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions."""
        if self._dimensions is None:
            self._load_model()
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        """Generate embedding for text."""
        self._load_model()
        embedding = self._model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        self._load_model()
        embeddings = self._model.encode(texts, convert_to_numpy=True)
        return [e.tolist() for e in embeddings]


class MockEmbeddingProvider(EmbeddingProvider):
    """Mock embedding provider for testing without ML dependencies."""

    name = "mock"
    dimensions = 384

    def embed(self, text: str) -> list[float]:
        """Generate deterministic mock embedding based on text hash."""
        import hashlib

        # Create a deterministic but varied embedding based on text
        text_hash = hashlib.md5(text.encode()).hexdigest()
        values = []
        for i in range(0, min(len(text_hash), self.dimensions * 2), 2):
            hex_pair = text_hash[i:i + 2]
            value = (int(hex_pair, 16) - 128) / 128  # Normalize to [-1, 1]
            values.append(value)

        # Pad to required dimensions
        while len(values) < self.dimensions:
            values.append(0.0)

        return values[:self.dimensions]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate mock embeddings for multiple texts."""
        return [self.embed(text) for text in texts]


def get_embedding_provider(
    provider_name: str = "local",
    **kwargs,
) -> EmbeddingProvider:
    """Get an embedding provider by name.

    Args:
        provider_name: Provider name (local, mock)
        **kwargs: Additional arguments for provider

    Returns:
        EmbeddingProvider instance
    """
    if provider_name == "local":
        return LocalEmbeddingProvider(**kwargs)
    elif provider_name == "mock":
        return MockEmbeddingProvider()
    else:
        raise ValueError(f"Unknown embedding provider: {provider_name}")
