"""Tests for Jinja2 template rendering."""

from __future__ import annotations

from pathlib import Path

import pytest
from agentic_sdlc.renderer import (
    TemplateRenderer,
    _extract_analysis_steps,
    _extract_fix_steps,
    build_template_context,
    render_workflow_output,
)
from jinja2 import UndefinedError
from jinja2.sandbox import SecurityError


class TestTemplateRenderer:
    """Tests for TemplateRenderer class."""

    def test_renderer_init_default_templates(self) -> None:
        """Test renderer initializes with default template directory."""
        renderer = TemplateRenderer()
        assert len(renderer.template_dirs) == 1
        assert renderer.template_dirs[0].name == "templates"

    def test_renderer_init_custom_templates(self, temp_dir: Path) -> None:
        """Test renderer initializes with custom template directories."""
        templates_dir = temp_dir / "templates"
        templates_dir.mkdir()

        renderer = TemplateRenderer([templates_dir])
        assert templates_dir in renderer.template_dirs

    def test_render_string_basic(self) -> None:
        """Test rendering a basic template string."""
        renderer = TemplateRenderer()
        result = renderer.render_string("Hello, {{ name }}!", {"name": "World"})
        assert result == "Hello, World!"

    def test_render_string_with_loop(self) -> None:
        """Test rendering template with loop."""
        renderer = TemplateRenderer()
        template = "{% for item in items %}{{ item }}{% endfor %}"
        result = renderer.render_string(template, {"items": ["a", "b", "c"]})
        assert result == "abc"

    def test_render_string_with_conditionals(self) -> None:
        """Test rendering template with conditionals."""
        renderer = TemplateRenderer()
        template = "{% if enabled %}ON{% else %}OFF{% endif %}"

        assert renderer.render_string(template, {"enabled": True}) == "ON"
        assert renderer.render_string(template, {"enabled": False}) == "OFF"

    def test_render_string_strict_undefined(self) -> None:
        """Test that undefined variables raise error."""
        renderer = TemplateRenderer()
        with pytest.raises(UndefinedError):
            renderer.render_string("{{ undefined_var }}", {})

    def test_render_string_nested_variables(self) -> None:
        """Test rendering with nested variable access."""
        renderer = TemplateRenderer()
        template = "{{ user.name }} - {{ user.email }}"
        context = {"user": {"name": "Alice", "email": "alice@example.com"}}

        result = renderer.render_string(template, context)
        assert result == "Alice - alice@example.com"

    def test_render_template_file(self, temp_dir: Path) -> None:
        """Test rendering from template file."""
        templates_dir = temp_dir / "templates"
        templates_dir.mkdir()

        template_file = templates_dir / "test.j2"
        template_file.write_text("Name: {{ name }}")

        renderer = TemplateRenderer([templates_dir])
        result = renderer.render("test.j2", {"name": "Test"})

        assert result == "Name: Test"

    def test_has_variables_true(self) -> None:
        """Test has_variables returns True for templates."""
        renderer = TemplateRenderer()
        assert renderer.has_variables("{{ variable }}") is True
        assert renderer.has_variables("{% if x %}{% endif %}") is True

    def test_has_variables_false(self) -> None:
        """Test has_variables returns False for plain text."""
        renderer = TemplateRenderer()
        assert renderer.has_variables("plain text") is False
        assert renderer.has_variables("no templates here") is False

    def test_add_template_dir(self, temp_dir: Path) -> None:
        """Test adding template directory."""
        new_dir = temp_dir / "new_templates"
        new_dir.mkdir()

        renderer = TemplateRenderer()
        original_count = len(renderer.template_dirs)

        renderer.add_template_dir(new_dir)

        assert len(renderer.template_dirs) == original_count + 1
        assert new_dir in renderer.template_dirs

    def test_add_template_dir_nonexistent(self, temp_dir: Path) -> None:
        """Test adding nonexistent directory is ignored."""
        nonexistent = temp_dir / "nonexistent"
        renderer = TemplateRenderer()
        original_count = len(renderer.template_dirs)

        renderer.add_template_dir(nonexistent)

        assert len(renderer.template_dirs) == original_count

    def test_add_template_dir_duplicate(self, temp_dir: Path) -> None:
        """Test adding duplicate directory is ignored."""
        new_dir = temp_dir / "templates"
        new_dir.mkdir()

        renderer = TemplateRenderer([new_dir])
        renderer.add_template_dir(new_dir)

        # Should still only have one entry
        assert renderer.template_dirs.count(new_dir) == 1


class TestSandboxedEnvironment:
    """Tests for sandboxed Jinja2 environment."""

    def test_sandbox_blocks_dangerous_attributes(self) -> None:
        """Test that sandbox blocks dangerous attribute access."""
        renderer = TemplateRenderer()

        # Attempt to access __class__ (common SSTI attack vector)
        with pytest.raises(SecurityError):
            renderer.render_string("{{ ''.__class__ }}", {})

    def test_sandbox_allows_normal_operations(self) -> None:
        """Test that normal operations work in sandbox."""
        renderer = TemplateRenderer()

        # String operations
        result = renderer.render_string("{{ name|upper }}", {"name": "test"})
        assert result == "TEST"

        # List operations
        result = renderer.render_string("{{ items|length }}", {"items": [1, 2, 3]})
        assert result == "3"

    def test_sandbox_allows_filters(self) -> None:
        """Test that standard filters work."""
        renderer = TemplateRenderer()

        # Various filters
        assert renderer.render_string("{{ x|default('N/A') }}", {}) == "N/A"
        assert renderer.render_string("{{ 'test'|capitalize }}", {}) == "Test"
        assert renderer.render_string("{{ [1,2,3]|join('-') }}", {}) == "1-2-3"


class TestExtractAnalysisSteps:
    """Tests for _extract_analysis_steps helper."""

    def test_extract_analysis_steps_basic(self) -> None:
        """Test extracting analysis steps from outputs."""
        step_outputs = {
            "analyze-bug": {"issues": 5},
            "analyze-debt": {"issues": 3},
            "analyze-security": {"issues": 2},
            "other-step": {"data": "ignored"},
        }

        result = _extract_analysis_steps(step_outputs)

        assert "analyze-bug" in result
        assert "analyze-debt" in result
        assert "analyze-security" in result
        assert "other-step" not in result

    def test_extract_analysis_steps_filters_invalid(self) -> None:
        """Test that invalid analysis types are filtered."""
        step_outputs = {
            "analyze-bug": {"issues": 5},
            "analyze-invalid": {"issues": 3},
            "analyze-and-fix-all": {"container": True},
        }

        result = _extract_analysis_steps(step_outputs)

        assert "analyze-bug" in result
        assert "analyze-invalid" not in result
        assert "analyze-and-fix-all" not in result

    def test_extract_analysis_steps_empty(self) -> None:
        """Test extracting from empty outputs."""
        result = _extract_analysis_steps({})
        assert result == {}

    def test_extract_analysis_steps_all_types(self) -> None:
        """Test all analysis types are recognized."""
        step_outputs = {
            "analyze-bug": {"type": "bug"},
            "analyze-debt": {"type": "debt"},
            "analyze-doc": {"type": "doc"},
            "analyze-security": {"type": "security"},
            "analyze-style": {"type": "style"},
        }

        result = _extract_analysis_steps(step_outputs)

        assert len(result) == 5


class TestExtractFixSteps:
    """Tests for _extract_fix_steps helper."""

    def test_extract_fix_steps_basic(self) -> None:
        """Test extracting fix steps from outputs."""
        step_outputs = {
            "fix-bugs": {"fixed": 3},
            "apply-fixes": {"applied": 5},
            "other-step": {"ignored": True},
        }

        result = _extract_fix_steps(step_outputs)

        assert "fix-bugs" in result
        assert "apply-fixes" in result
        assert "other-step" not in result

    def test_extract_fix_steps_empty(self) -> None:
        """Test extracting from empty outputs."""
        result = _extract_fix_steps({})
        assert result == {}


class TestBuildTemplateContext:
    """Tests for building template context."""

    def test_build_template_context_basic(self) -> None:
        """Test building basic template context."""
        context = build_template_context(
            workflow_name="test-workflow",
            started_at="2026-01-11T14:30:00Z",
            completed_at="2026-01-11T15:00:00Z",
            step_outputs={"step1": {"result": "ok"}},
            files_changed=["file1.py", "file2.py"],
            branches=["feature/test"],
            pull_requests=[{"number": 123, "url": "https://github.com/test"}],
            inputs={"var": "value"},
        )

        assert context["workflow"]["name"] == "test-workflow"
        assert context["workflow"]["started_at"] == "2026-01-11T14:30:00Z"
        assert context["workflow"]["completed_at"] == "2026-01-11T15:00:00Z"
        assert context["steps"] == {"step1": {"result": "ok"}}
        assert context["files_changed"] == ["file1.py", "file2.py"]
        assert context["branches"] == ["feature/test"]
        assert len(context["pull_requests"]) == 1
        assert context["inputs"] == {"var": "value"}

    def test_build_template_context_extracts_analysis(self) -> None:
        """Test context extracts analysis steps."""
        context = build_template_context(
            workflow_name="test",
            started_at="",
            completed_at=None,
            step_outputs={
                "analyze-bug": {"issues": 5},
                "other-step": {"data": "ignored"},
            },
            files_changed=[],
            branches=[],
            pull_requests=[],
            inputs={},
        )

        assert "analyze-bug" in context["analysis_steps"]
        assert "other-step" not in context["analysis_steps"]

    def test_build_template_context_extracts_fixes(self) -> None:
        """Test context extracts fix steps."""
        context = build_template_context(
            workflow_name="test",
            started_at="",
            completed_at=None,
            step_outputs={
                "fix-bugs": {"fixed": 3},
                "apply-fixes": {"applied": 2},
            },
            files_changed=[],
            branches=[],
            pull_requests=[],
            inputs={},
        )

        assert "fix-bugs" in context["fix_steps"]
        assert "apply-fixes" in context["fix_steps"]


class TestRenderWorkflowOutput:
    """Tests for render_workflow_output function."""

    def test_render_workflow_output_creates_file(self, temp_dir: Path) -> None:
        """Test rendering output creates file."""
        templates_dir = temp_dir / "templates"
        templates_dir.mkdir()
        template_file = templates_dir / "output.j2"
        template_file.write_text("Workflow: {{ workflow.name }}")

        output_path = temp_dir / "output" / "result.md"
        context = {"workflow": {"name": "test-workflow"}}

        render_workflow_output(
            template_path=Path("output.j2"),
            output_path=output_path,
            context=context,
            template_dirs=[templates_dir],
        )

        assert output_path.exists()
        assert output_path.read_text() == "Workflow: test-workflow"

    def test_render_workflow_output_creates_directories(self, temp_dir: Path) -> None:
        """Test rendering creates necessary directories."""
        templates_dir = temp_dir / "templates"
        templates_dir.mkdir()
        template_file = templates_dir / "output.j2"
        template_file.write_text("Content")

        output_path = temp_dir / "deep" / "nested" / "output.md"

        render_workflow_output(
            template_path=Path("output.j2"),
            output_path=output_path,
            context={},
            template_dirs=[templates_dir],
        )

        assert output_path.exists()

    def test_render_workflow_output_absolute_template(self, temp_dir: Path) -> None:
        """Test rendering with absolute template path."""
        template_file = temp_dir / "absolute_template.j2"
        template_file.write_text("Value: {{ value }}")

        output_path = temp_dir / "output.md"
        context = {"value": "test"}

        render_workflow_output(
            template_path=template_file,  # Absolute path
            output_path=output_path,
            context=context,
        )

        assert output_path.exists()
        assert output_path.read_text() == "Value: test"
