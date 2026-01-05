"""Output handlers for different output types."""

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


@dataclass
class OutputResult:
    """Result of writing an output."""

    success: bool
    path: Optional[str] = None
    hash: Optional[str] = None
    size_bytes: int = 0
    error: Optional[str] = None


class OutputHandler(ABC):
    """Base class for output handlers."""

    @abstractmethod
    async def write(
        self,
        name: str,
        content: str,
        working_dir: Path,
        path: Optional[str] = None,
        **kwargs,
    ) -> OutputResult:
        """Write output.

        Args:
            name: Output name
            content: Output content
            working_dir: Working directory
            path: Optional specific path
            **kwargs: Additional options

        Returns:
            OutputResult with write status
        """
        pass


class FileHandler(OutputHandler):
    """Write output to a file."""

    async def write(
        self,
        name: str,
        content: str,
        working_dir: Path,
        path: Optional[str] = None,
        **kwargs,
    ) -> OutputResult:
        """Write content to file."""
        try:
            # Determine file path
            if path:
                file_path = working_dir / path
            else:
                file_path = working_dir / f"{name}.md"

            # Ensure parent directory exists
            file_path.parent.mkdir(parents=True, exist_ok=True)

            # Write file
            file_path.write_text(content, encoding="utf-8")

            # Calculate hash
            content_hash = hashlib.sha256(content.encode()).hexdigest()

            return OutputResult(
                success=True,
                path=str(file_path),
                hash=content_hash,
                size_bytes=len(content.encode("utf-8")),
            )
        except Exception as e:
            return OutputResult(
                success=False,
                error=str(e),
            )


class MessageHandler(OutputHandler):
    """Log output as a message (to console and optionally Kafka)."""

    def __init__(self, kafka=None):
        """Initialize with optional Kafka client."""
        self.kafka = kafka

    async def write(
        self,
        name: str,
        content: str,
        working_dir: Path,
        path: Optional[str] = None,
        workflow_id: Optional[str] = None,
        **kwargs,
    ) -> OutputResult:
        """Log message."""
        # Print to console
        print(f"[{name}] {content[:500]}...")

        # Publish to Kafka if available
        if self.kafka and workflow_id:
            self.kafka.publish_workflow_event(
                workflow_id=workflow_id,
                event_type="output",
                metadata={"name": name, "content_preview": content[:500]},
            )

        return OutputResult(
            success=True,
            size_bytes=len(content.encode("utf-8")),
        )


class ArtifactHandler(OutputHandler):
    """Store output as an artifact in a dedicated directory."""

    def __init__(self, artifacts_dir: str = ".agentic/artifacts"):
        """Initialize with artifacts directory."""
        self.artifacts_dir = artifacts_dir

    async def write(
        self,
        name: str,
        content: str,
        working_dir: Path,
        path: Optional[str] = None,
        workflow_id: Optional[str] = None,
        **kwargs,
    ) -> OutputResult:
        """Store artifact."""
        try:
            # Create artifacts directory
            artifacts_path = working_dir / self.artifacts_dir
            artifacts_path.mkdir(parents=True, exist_ok=True)

            # Generate filename with timestamp
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            if workflow_id:
                filename = f"{workflow_id}_{name}_{timestamp}.md"
            else:
                filename = f"{name}_{timestamp}.md"

            if path:
                # Use provided path within artifacts dir
                file_path = artifacts_path / path
            else:
                file_path = artifacts_path / filename

            # Ensure parent exists
            file_path.parent.mkdir(parents=True, exist_ok=True)

            # Write file
            file_path.write_text(content, encoding="utf-8")

            # Calculate hash
            content_hash = hashlib.sha256(content.encode()).hexdigest()

            return OutputResult(
                success=True,
                path=str(file_path),
                hash=content_hash,
                size_bytes=len(content.encode("utf-8")),
            )
        except Exception as e:
            return OutputResult(
                success=False,
                error=str(e),
            )


# Handler registry
HANDLERS: dict[str, type[OutputHandler]] = {
    "file": FileHandler,
    "message": MessageHandler,
    "artifact": ArtifactHandler,
}


def get_handler(output_type: str, **kwargs) -> OutputHandler:
    """Get handler for output type."""
    handler_cls = HANDLERS.get(output_type)
    if not handler_cls:
        raise ValueError(f"Unknown output type: {output_type}")
    return handler_cls(**kwargs)


async def write_output(
    output_type: str,
    name: str,
    content: str,
    working_dir: Path,
    **kwargs,
) -> OutputResult:
    """Write output with the appropriate handler."""
    handler = get_handler(output_type)
    return await handler.write(name, content, working_dir, **kwargs)
