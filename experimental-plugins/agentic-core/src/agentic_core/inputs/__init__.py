"""Input processors for workflows."""

from agentic_core.inputs.processors import (
    CodebaseProcessor,
    FileProcessor,
    GithubIssueProcessor,
    InputProcessor,
    UrlProcessor,
    get_processor,
    process_input,
)

__all__ = [
    "InputProcessor",
    "FileProcessor",
    "CodebaseProcessor",
    "UrlProcessor",
    "GithubIssueProcessor",
    "get_processor",
    "process_input",
]
