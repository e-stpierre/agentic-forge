"""Jinja2 template rendering for workflows."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from jinja2 import FileSystemLoader, StrictUndefined, Undefined
from jinja2.sandbox import SandboxedEnvironment

logger = logging.getLogger(__name__)


class WarnOnUndefined(Undefined):
    """Log warning and preserve original syntax for undefined variables.

    Instead of raising an exception or returning empty string, this class
    logs a warning and returns the original Jinja2 syntax so the template
    continues processing.
    """

    def __str__(self) -> str:
        """Return original Jinja2 syntax and log warning."""
        var_name = self._undefined_name
        logger.warning(
            "Template variable '%s' is undefined, leaving as-is: {{ %s }}",
            var_name,
            var_name,
        )
        return "{{ " + str(var_name) + " }}"

    def __iter__(self):
        """Return empty iterator for undefined variables in loops."""
        return iter([])

    def __bool__(self) -> bool:
        """Return False for undefined variables in boolean contexts."""
        return False

    def __getattr__(self, name: str) -> WarnOnUndefined:
        """Return WarnOnUndefined for attribute access on undefined variables."""
        return WarnOnUndefined(
            hint=self._undefined_hint,
            obj=self._undefined_obj,
            name=f"{self._undefined_name}.{name}",
            exc=self._undefined_exception,
        )


class TemplateRenderer:
    """Render Jinja2 templates with workflow context.

    Uses SandboxedEnvironment to prevent template injection attacks.
    The sandbox restricts access to dangerous attributes and methods,
    preventing malicious templates from executing arbitrary Python code.
    """

    def __init__(
        self,
        template_dirs: list[Path] | None = None,
        strict_mode: bool = False,
    ):
        """Initialize the template renderer.

        Args:
            template_dirs: List of directories to search for templates.
            strict_mode: If True, raise exception on undefined variables.
                        If False (default), log warning and preserve original syntax.
        """
        if template_dirs is None:
            default_templates = Path(__file__).parent / "templates"
            template_dirs = [default_templates]

        self.template_dirs = template_dirs
        self.strict_mode = strict_mode

        # Choose undefined behavior based on strict_mode
        undefined_class = StrictUndefined if strict_mode else WarnOnUndefined

        # Use SandboxedEnvironment to prevent SSTI attacks
        # autoescape=False is intentional: we render prompts/markdown, not HTML
        self.env = SandboxedEnvironment(
            loader=FileSystemLoader([str(d) for d in template_dirs if d.exists()]),
            autoescape=False,
            undefined=undefined_class,
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
            self.env.loader = FileSystemLoader([str(d) for d in self.template_dirs if d.exists()])


def _extract_analysis_steps(step_outputs: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract analysis steps (analyze-*) from all step outputs.

    This flattens nested steps into a dictionary keyed by step name,
    making it easier for templates to iterate over analysis results.

    Filters to only include actual analysis type steps (bug, debt, doc, security, style),
    not container steps like 'analyze-and-fix-all'.

    Args:
        step_outputs: Dictionary of all step outputs from the workflow.

    Returns:
        Dictionary containing only analyze-* steps with their data.
    """
    # Known analysis types that should be included
    analysis_types = ("bug", "debt", "doc", "security", "style")

    analysis_steps: dict[str, dict[str, Any]] = {}
    for step_name, step_data in step_outputs.items():
        if step_name.startswith("analyze-"):
            # Extract the type after 'analyze-' prefix
            analysis_type = step_name[len("analyze-") :]
            if analysis_type in analysis_types:
                analysis_steps[step_name] = step_data
    return analysis_steps


def _extract_fix_steps(step_outputs: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Extract fix steps (fix-* or apply-*) from all step outputs.

    Args:
        step_outputs: Dictionary of all step outputs from the workflow.

    Returns:
        Dictionary containing only fix-related steps with their data.
    """
    fix_steps: dict[str, dict[str, Any]] = {}
    for step_name, step_data in step_outputs.items():
        if step_name.startswith("fix-") or step_name.startswith("apply-"):
            fix_steps[step_name] = step_data
    return fix_steps


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
    """Build the template context object for output templates.

    Provides both the raw step_outputs and pre-filtered analysis/fix steps
    to make template iteration cleaner.
    """
    # Extract analysis and fix steps for easier template access
    analysis_steps = _extract_analysis_steps(step_outputs)
    fix_steps = _extract_fix_steps(step_outputs)

    return {
        "workflow": {
            "name": workflow_name,
            "started_at": started_at,
            "completed_at": completed_at,
        },
        "steps": step_outputs,
        "analysis_steps": analysis_steps,
        "fix_steps": fix_steps,
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
    strict_mode: bool = False,
) -> None:
    """Render a workflow output template to a file.

    Args:
        template_path: Path to the template file.
        output_path: Path to write the rendered output.
        context: Template context variables.
        template_dirs: List of directories to search for templates.
        strict_mode: If True, raise exception on undefined variables.
    """
    renderer = TemplateRenderer(template_dirs, strict_mode=strict_mode)

    if template_path.is_absolute():
        content = template_path.read_text(encoding="utf-8")
        rendered = renderer.render_string(content, context)
    else:
        rendered = renderer.render(str(template_path), context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rendered, encoding="utf-8")
