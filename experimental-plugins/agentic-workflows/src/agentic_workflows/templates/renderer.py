"""Jinja2 template rendering for workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape


class TemplateRenderer:
    """Render Jinja2 templates with workflow context."""

    def __init__(self, template_dirs: list[Path] | None = None):
        if template_dirs is None:
            default_templates = Path(__file__).parent.parent.parent.parent / "templates"
            template_dirs = [default_templates]

        self.template_dirs = template_dirs
        self.env = Environment(
            loader=FileSystemLoader([str(d) for d in template_dirs if d.exists()]),
            autoescape=select_autoescape(default=False),
            undefined=StrictUndefined,
        )
        self.env.globals = {}

    def render(self, template_name: str, context: dict[str, Any]) -> str:
        """Render a template file with context."""
        template = self.env.get_template(template_name)
        return template.render(**context)

    def render_string(self, template_str: str, context: dict[str, Any]) -> str:
        """Render a template string with context."""
        template = self.env.from_string(template_str)
        return template.render(**context)

    def has_variables(self, text: str) -> bool:
        """Check if text contains Jinja2 variables."""
        return "{{" in text or "{%" in text

    def add_template_dir(self, path: Path) -> None:
        """Add a template directory to the search path."""
        if path.exists() and path not in self.template_dirs:
            self.template_dirs.append(path)
            self.env.loader = FileSystemLoader(
                [str(d) for d in self.template_dirs if d.exists()]
            )


def build_template_context(
    workflow_name: str,
    started_at: str,
    completed_at: str | None,
    step_outputs: dict[str, Any],
    files_changed: list[str],
    branches: list[str],
    pull_requests: list[dict[str, Any]],
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Build the template context object for output templates."""
    return {
        "workflow": {
            "name": workflow_name,
            "started_at": started_at,
            "completed_at": completed_at,
        },
        "steps": step_outputs,
        "files_changed": files_changed,
        "branches": branches,
        "pull_requests": pull_requests,
        "inputs": inputs,
    }


def render_workflow_output(
    template_path: Path,
    output_path: Path,
    context: dict[str, Any],
    template_dirs: list[Path] | None = None,
) -> None:
    """Render a workflow output template to a file."""
    renderer = TemplateRenderer(template_dirs)

    if template_path.is_absolute():
        content = template_path.read_text(encoding="utf-8")
        rendered = renderer.render_string(content, context)
    else:
        rendered = renderer.render(str(template_path), context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
