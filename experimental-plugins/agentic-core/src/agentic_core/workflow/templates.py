"""Jinja2 template resolution for workflows."""

from typing import Any, Optional

from jinja2 import StrictUndefined
from jinja2.sandbox import SandboxedEnvironment


class TemplateResolver:
    """Resolves Jinja2 templates in workflow prompts and configurations.

    Uses SandboxedEnvironment to prevent template injection attacks.
    The sandbox restricts access to dangerous attributes and methods,
    preventing malicious templates from executing arbitrary Python code.
    """

    def __init__(self):
        """Initialize template resolver."""
        # Use SandboxedEnvironment to prevent SSTI attacks
        # autoescape=False is intentional: we render prompts/markdown, not HTML
        self.env = SandboxedEnvironment(
            undefined=StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )

        # Register custom filters
        self.env.filters["truncate_lines"] = self._truncate_lines
        self.env.filters["code_block"] = self._code_block
        self.env.filters["bullet_list"] = self._bullet_list

    def resolve(self, template_str: str, context: dict[str, Any]) -> str:
        """Resolve template string with context.

        Args:
            template_str: Template string with {{ variables }}
            context: Dictionary of variables to substitute

        Returns:
            Resolved string
        """
        template = self.env.from_string(template_str)
        return template.render(context)

    def has_variables(self, template_str: str) -> bool:
        """Check if string contains template variables.

        Args:
            template_str: String to check

        Returns:
            True if contains {{ }} patterns
        """
        return "{{" in template_str and "}}" in template_str

    def extract_variables(self, template_str: str) -> set[str]:
        """Extract variable names from template string.

        Args:
            template_str: Template string

        Returns:
            Set of variable names found
        """
        from jinja2 import meta

        ast = self.env.parse(template_str)
        return meta.find_undeclared_variables(ast)

    def build_step_context(
        self,
        variables: dict[str, Any],
        step_outputs: dict[str, Any],
        inputs: dict[str, Any],
        git_info: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Build complete context for step template resolution.

        Args:
            variables: CLI variables (--var key=value)
            step_outputs: Outputs from previous steps
            inputs: Processed workflow inputs
            git_info: Git information (diff, branch, etc.)

        Returns:
            Complete context dictionary
        """
        context = {
            **variables,
            "outputs": step_outputs,
            "inputs": inputs,
        }

        if git_info:
            context["git"] = git_info

        return context

    @staticmethod
    def _truncate_lines(text: str, max_lines: int = 100) -> str:
        """Truncate text to max lines."""
        lines = text.split("\n")
        if len(lines) <= max_lines:
            return text
        return "\n".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} more lines)"

    @staticmethod
    def _code_block(text: str, language: str = "") -> str:
        """Wrap text in a code block."""
        return f"```{language}\n{text}\n```"

    @staticmethod
    def _bullet_list(items: list[str]) -> str:
        """Format items as a bullet list."""
        return "\n".join(f"- {item}" for item in items)


def resolve_template(template_str: str, context: dict[str, Any]) -> str:
    """Convenience function for one-off template resolution.

    Args:
        template_str: Template string
        context: Variables to substitute

    Returns:
        Resolved string
    """
    resolver = TemplateResolver()
    return resolver.resolve(template_str, context)
