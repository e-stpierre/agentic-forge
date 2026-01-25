"""Input processors for different input types."""

import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


@dataclass
class ProcessedInput:
    """Result of processing an input."""

    name: str
    type: str
    content: str
    file_paths: list[str] = None
    metadata: dict[str, Any] = None


class InputProcessor(ABC):
    """Base class for input processors."""

    @abstractmethod
    async def process(
        self,
        source: str,
        name: str,
        working_dir: Path,
        **kwargs,
    ) -> ProcessedInput:
        """Process an input source.

        Args:
            source: Input source (file path, URL, etc.)
            name: Input name
            working_dir: Working directory
            **kwargs: Additional arguments

        Returns:
            ProcessedInput with content and metadata
        """
        pass


class FileProcessor(InputProcessor):
    """Process file inputs."""

    async def process(
        self,
        source: str,
        name: str,
        working_dir: Path,
        **kwargs,
    ) -> ProcessedInput:
        """Read file content."""
        path = working_dir / source
        if not path.exists():
            return ProcessedInput(
                name=name,
                type="file",
                content=f"[File not found: {source}]",
                metadata={"error": "File not found"},
            )

        try:
            content = path.read_text(encoding="utf-8")
            return ProcessedInput(
                name=name,
                type="file",
                content=content,
                file_paths=[str(path)],
                metadata={"size_bytes": len(content)},
            )
        except Exception as e:
            return ProcessedInput(
                name=name,
                type="file",
                content=f"[Error reading file: {e}]",
                metadata={"error": str(e)},
            )


class CodebaseProcessor(InputProcessor):
    """Process codebase inputs with glob patterns."""

    def __init__(self, max_files: int = 100, max_file_size: int = 50000):
        """Initialize processor.

        Args:
            max_files: Maximum number of files to include
            max_file_size: Maximum size per file in bytes
        """
        self.max_files = max_files
        self.max_file_size = max_file_size

    async def process(
        self,
        source: str,
        name: str,
        working_dir: Path,
        glob_pattern: Optional[str] = None,
        **kwargs,
    ) -> ProcessedInput:
        """Read codebase files matching glob pattern."""
        base_path = working_dir / source
        if not base_path.exists():
            return ProcessedInput(
                name=name,
                type="codebase",
                content=f"[Directory not found: {source}]",
                metadata={"error": "Directory not found"},
            )

        # Find files
        pattern = glob_pattern or "**/*"
        if base_path.is_file():
            files = [base_path]
        else:
            files = list(base_path.glob(pattern))

        # Filter to text files and limit count
        text_files = []
        for f in files:
            if f.is_file() and self._is_text_file(f):
                text_files.append(f)
                if len(text_files) >= self.max_files:
                    break

        # Read and concatenate
        content_parts = []
        file_paths = []

        for file_path in text_files:
            try:
                if file_path.stat().st_size > self.max_file_size:
                    content = f"[File too large: {file_path.name}]"
                else:
                    content = file_path.read_text(encoding="utf-8", errors="replace")

                rel_path = file_path.relative_to(working_dir)
                content_parts.append(f"### {rel_path}\n```\n{content}\n```\n")
                file_paths.append(str(file_path))
            except Exception:
                continue

        return ProcessedInput(
            name=name,
            type="codebase",
            content="\n".join(content_parts),
            file_paths=file_paths,
            metadata={
                "file_count": len(file_paths),
                "truncated": len(files) > self.max_files,
            },
        )

    def _is_text_file(self, path: Path) -> bool:
        """Check if file is likely a text file."""
        # Skip common binary extensions
        binary_extensions = {
            ".pyc",
            ".pyo",
            ".exe",
            ".dll",
            ".so",
            ".dylib",
            ".zip",
            ".tar",
            ".gz",
            ".bz2",
            ".xz",
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".bmp",
            ".ico",
            ".mp3",
            ".mp4",
            ".wav",
            ".avi",
            ".mov",
            ".pdf",
            ".doc",
            ".docx",
            ".xls",
            ".xlsx",
            ".db",
            ".sqlite",
            ".lock",
        }
        if path.suffix.lower() in binary_extensions:
            return False

        # Skip hidden and common non-code directories
        for part in path.parts:
            if part.startswith(".") or part in {"node_modules", "__pycache__", "venv", ".venv"}:
                return False

        return True


class UrlProcessor(InputProcessor):
    """Process URL inputs."""

    async def process(
        self,
        source: str,
        name: str,
        working_dir: Path,
        **kwargs,
    ) -> ProcessedInput:
        """Fetch and extract text from URL."""
        try:
            # Use httpx or requests to fetch URL
            import urllib.request

            with urllib.request.urlopen(source, timeout=30) as response:
                html = response.read().decode("utf-8", errors="replace")

            # Simple HTML to text conversion
            content = self._html_to_text(html)

            return ProcessedInput(
                name=name,
                type="url",
                content=content,
                metadata={"url": source},
            )
        except Exception as e:
            return ProcessedInput(
                name=name,
                type="url",
                content=f"[Error fetching URL: {e}]",
                metadata={"error": str(e), "url": source},
            )

    def _html_to_text(self, html: str) -> str:
        """Simple HTML to text extraction."""
        import re

        # Remove script and style elements
        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)

        # Remove tags
        text = re.sub(r"<[^>]+>", " ", html)

        # Decode entities
        text = text.replace("&nbsp;", " ")
        text = text.replace("&amp;", "&")
        text = text.replace("&lt;", "<")
        text = text.replace("&gt;", ">")

        # Clean up whitespace
        text = re.sub(r"\s+", " ", text)
        return text.strip()


class GithubIssueProcessor(InputProcessor):
    """Process GitHub issue inputs using gh CLI."""

    async def process(
        self,
        source: str,
        name: str,
        working_dir: Path,
        **kwargs,
    ) -> ProcessedInput:
        """Fetch GitHub issue using gh CLI."""
        try:
            # Parse source (expected format: owner/repo#123 or #123)
            if "#" in source:
                if "/" in source:
                    repo_part, issue_num = source.rsplit("#", 1)
                    cmd = [
                        "gh",
                        "issue",
                        "view",
                        issue_num,
                        "-R",
                        repo_part,
                        "--json",
                        "title,body,state,labels,author,comments",
                    ]
                else:
                    issue_num = source.replace("#", "")
                    cmd = [
                        "gh",
                        "issue",
                        "view",
                        issue_num,
                        "--json",
                        "title,body,state,labels,author,comments",
                    ]
            else:
                return ProcessedInput(
                    name=name,
                    type="github_issue",
                    content=f"[Invalid issue format: {source}]",
                    metadata={"error": "Invalid format"},
                )

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=str(working_dir),
                timeout=30,
            )

            if result.returncode != 0:
                return ProcessedInput(
                    name=name,
                    type="github_issue",
                    content=f"[Error fetching issue: {result.stderr}]",
                    metadata={"error": result.stderr},
                )

            import json

            data = json.loads(result.stdout)

            # Format issue content
            content_parts = [
                f"# Issue: {data.get('title', 'Unknown')}",
                f"State: {data.get('state', 'unknown')}",
                f"Author: {data.get('author', {}).get('login', 'unknown')}",
                "",
                "## Description",
                data.get("body", "No description"),
            ]

            # Add comments
            comments = data.get("comments", [])
            if comments:
                content_parts.append("\n## Comments")
                for comment in comments[:10]:  # Limit comments
                    author = comment.get("author", {}).get("login", "unknown")
                    body = comment.get("body", "")
                    content_parts.append(f"\n**{author}:**\n{body}")

            return ProcessedInput(
                name=name,
                type="github_issue",
                content="\n".join(content_parts),
                metadata={
                    "issue": source,
                    "state": data.get("state"),
                    "title": data.get("title"),
                },
            )
        except subprocess.TimeoutExpired:
            return ProcessedInput(
                name=name,
                type="github_issue",
                content="[Timeout fetching issue]",
                metadata={"error": "Timeout"},
            )
        except Exception as e:
            return ProcessedInput(
                name=name,
                type="github_issue",
                content=f"[Error: {e}]",
                metadata={"error": str(e)},
            )


# Processor registry
PROCESSORS: dict[str, type[InputProcessor]] = {
    "file": FileProcessor,
    "codebase": CodebaseProcessor,
    "url": UrlProcessor,
    "github_issue": GithubIssueProcessor,
}


def get_processor(input_type: str) -> InputProcessor:
    """Get processor for input type."""
    processor_cls = PROCESSORS.get(input_type)
    if not processor_cls:
        raise ValueError(f"Unknown input type: {input_type}")
    return processor_cls()


async def process_input(
    input_type: str,
    source: str,
    name: str,
    working_dir: Path,
    **kwargs,
) -> ProcessedInput:
    """Process an input with the appropriate processor."""
    processor = get_processor(input_type)
    return await processor.process(source, name, working_dir, **kwargs)
