"""Tests for console output utilities."""

from __future__ import annotations

import io

from agentic_sdlc.console import (
    Color,
    ConsoleOutput,
    OutputLevel,
    _colorize,
    extract_json,
    extract_summary,
)


class TestOutputLevel:
    """Tests for OutputLevel enum."""

    def test_output_level_values(self) -> None:
        """Test output level values."""
        assert OutputLevel.BASE.value == "base"
        assert OutputLevel.ALL.value == "all"


class TestColor:
    """Tests for Color enum."""

    def test_color_values_are_ansi(self) -> None:
        """Test color values are ANSI escape codes."""
        assert Color.RESET.value == "\033[0m"
        assert Color.BOLD.value == "\033[1m"
        assert Color.RED.value.startswith("\033[")

    def test_all_colors_exist(self) -> None:
        """Test all expected colors exist."""
        colors = [
            Color.RESET,
            Color.BOLD,
            Color.DIM,
            Color.RED,
            Color.GREEN,
            Color.YELLOW,
            Color.BLUE,
            Color.MAGENTA,
            Color.CYAN,
            Color.WHITE,
            Color.BRIGHT_RED,
            Color.BRIGHT_GREEN,
            Color.BRIGHT_YELLOW,
            Color.BRIGHT_BLUE,
            Color.BRIGHT_CYAN,
        ]
        assert len(colors) == 15


class TestColorize:
    """Tests for _colorize function."""

    def test_colorize_with_color_support(self, monkeypatch) -> None:
        """Test colorize when color is supported."""

        # Create a mock stdout that supports color
        class MockStdout:
            def isatty(self):
                return True

        import sys

        monkeypatch.setattr(sys, "stdout", MockStdout())

        result = _colorize("test", Color.RED)
        assert Color.RED.value in result
        assert Color.RESET.value in result
        assert "test" in result

    def test_colorize_multiple_colors(self, monkeypatch) -> None:
        """Test colorize with multiple color codes."""

        class MockStdout:
            def isatty(self):
                return True

        import sys

        monkeypatch.setattr(sys, "stdout", MockStdout())

        result = _colorize("test", Color.BOLD, Color.RED)
        assert Color.BOLD.value in result
        assert Color.RED.value in result


class TestConsoleOutput:
    """Tests for ConsoleOutput class."""

    def test_console_output_defaults(self) -> None:
        """Test default console output settings."""
        console = ConsoleOutput()
        assert console.level == OutputLevel.BASE

    def test_console_output_custom_level(self) -> None:
        """Test console output with custom level."""
        console = ConsoleOutput(level=OutputLevel.ALL)
        assert console.level == OutputLevel.ALL

    def test_console_output_custom_stream(self) -> None:
        """Test console output with custom stream."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console._print("test message")

        output = stream.getvalue()
        assert "test message" in output

    def test_workflow_start(self) -> None:
        """Test workflow start message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.workflow_start("test-workflow", "workflow-123")

        output = stream.getvalue()
        assert "test-workflow" in output
        assert "workflow-123" in output

    def test_workflow_complete_success(self) -> None:
        """Test workflow complete message for success."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.workflow_complete("test-workflow", "completed")

        output = stream.getvalue()
        assert "COMPLETED" in output

    def test_workflow_complete_failed(self) -> None:
        """Test workflow complete message for failure."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.workflow_complete("test-workflow", "failed")

        output = stream.getvalue()
        assert "FAILED" in output

    def test_step_start(self) -> None:
        """Test step start message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.step_start("analyze-bugs", "prompt")

        output = stream.getvalue()
        assert "analyze-bugs" in output
        assert "prompt" in output

    def test_step_complete(self) -> None:
        """Test step complete message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.step_complete("test-step", summary="Task completed")

        output = stream.getvalue()
        assert "test-step" in output
        assert "OK" in output
        assert "Task completed" in output

    def test_step_complete_no_summary(self) -> None:
        """Test step complete without summary."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.step_complete("test-step")

        output = stream.getvalue()
        assert "test-step" in output
        assert "OK" in output

    def test_step_complete_truncates_summary(self) -> None:
        """Test step complete truncates long summary."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        long_summary = "\n".join([f"Line {i}: " + "x" * 300 for i in range(10)])
        console.step_complete("test-step", summary=long_summary)

        output = stream.getvalue()
        # Should show only first 5 lines with truncation
        assert "..." in output
        assert "more lines" in output

    def test_step_failed(self) -> None:
        """Test step failed message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.step_failed("test-step", error="Something went wrong")

        output = stream.getvalue()
        assert "test-step" in output
        assert "FAIL" in output
        assert "Something went wrong" in output

    def test_step_retry(self) -> None:
        """Test step retry message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.step_retry("test-step", attempt=2, max_attempts=3, error="Timeout")

        output = stream.getvalue()
        assert "RETRY" in output
        assert "2/3" in output
        assert "Timeout" in output

    def test_ralph_iteration(self) -> None:
        """Test ralph iteration message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.ralph_iteration("apply-fixes", 3, 10, summary="Fixed 2 issues")

        output = stream.getvalue()
        assert "3/10" in output
        assert "apply-fixes" in output
        assert "Fixed 2 issues" in output

    def test_ralph_complete(self) -> None:
        """Test ralph complete message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.ralph_complete("apply-fixes", 5, 10)

        output = stream.getvalue()
        assert "OK" in output
        assert "apply-fixes" in output
        assert "5/10" in output

    def test_ralph_max_iterations(self) -> None:
        """Test ralph max iterations message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.ralph_max_iterations("apply-fixes", 10)

        output = stream.getvalue()
        assert "WARN" in output
        assert "max iterations" in output
        assert "10" in output

    def test_info_message(self) -> None:
        """Test info message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.info("Information message")

        output = stream.getvalue()
        assert "INFO" in output
        assert "Information message" in output

    def test_warning_message(self) -> None:
        """Test warning message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.warning("Warning message")

        output = stream.getvalue()
        assert "WARN" in output
        assert "Warning message" in output

    def test_error_message(self) -> None:
        """Test error message."""
        stream = io.StringIO()
        console = ConsoleOutput(stream=stream)

        console.error("Error message")

        output = stream.getvalue()
        assert "ERROR" in output
        assert "Error message" in output

    def test_stream_text_all_mode(self) -> None:
        """Test stream_text in ALL output mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.ALL, stream=stream)

        console.stream_text("Hello\nWorld")

        output = stream.getvalue()
        # ALL mode converts \n to \r\n for proper terminal output
        assert output == "Hello\r\nWorld"

    def test_stream_text_base_mode_shows_last_line(self) -> None:
        """Test stream_text shows only last line in BASE mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.BASE, stream=stream)

        console.stream_text("First line\nSecond line\nThird line")

        output = stream.getvalue()
        # BASE mode shows only the last non-empty line
        assert "Third line" in output
        assert "\r" in output  # Uses carriage return
        assert "\033[K" in output  # Clears to end of line

    def test_stream_text_base_mode_skips_empty_lines(self) -> None:
        """Test stream_text skips empty lines when finding last line in BASE mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.BASE, stream=stream)

        console.stream_text("Content\n\n")

        output = stream.getvalue()
        assert "Content" in output

    def test_stream_text_all_mode_preserves_multiline(self) -> None:
        """Test stream_text preserves multi-line output in ALL mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.ALL, stream=stream)

        console.stream_text("Line 1\nLine 2\nLine 3")

        output = stream.getvalue()
        assert "Line 1" in output
        assert "Line 2" in output
        assert "Line 3" in output


class TestExtractSummary:
    """Tests for extract_summary function."""

    def test_extract_summary_with_marker(self) -> None:
        """Test extracting summary with explicit marker."""
        output = """
Some header text.

## Summary

This is the summary content.
It has multiple lines.

## Next Section
"""
        summary = extract_summary(output)

        assert "summary content" in summary
        assert "Next Section" not in summary

    def test_extract_summary_various_markers(self) -> None:
        """Test extracting summary with various markers."""
        markers = [
            ("## Summary\nSummary text", "Summary text"),
            ("### Summary\nSmaller summary", "Smaller summary"),
            ("Summary:\nInline summary", "Inline summary"),
            ("Result:\nResult text", "Result text"),
            ("Completed:\nCompletion text", "Completion text"),
            ("Done:\nDone text", "Done text"),
        ]

        for output, expected in markers:
            summary = extract_summary(output)
            assert expected in summary, f"Failed for marker output: {output}"

    def test_extract_summary_no_marker(self) -> None:
        """Test extracting summary without markers (uses last lines)."""
        output = """
First line of output.
Second line.
Third line.
Fourth line.
Fifth line.
Sixth line.
Seventh line.
"""
        summary = extract_summary(output)

        # Should contain some of the last lines
        assert "line" in summary

    def test_extract_summary_empty_input(self) -> None:
        """Test extracting summary from empty input."""
        assert extract_summary("") == ""
        assert extract_summary("   ") == ""

    def test_extract_summary_max_lines(self) -> None:
        """Test max_lines parameter."""
        output = """
## Summary

Line 1
Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
"""
        summary = extract_summary(output, max_lines=3)

        # Should have at most 3 lines (excluding empty ones)
        lines = [line for line in summary.split("\n") if line.strip()]
        assert len(lines) <= 3

    def test_extract_summary_max_chars(self) -> None:
        """Test max_chars parameter."""
        long_line = "x" * 1000
        output = f"## Summary\n{long_line}"

        summary = extract_summary(output, max_chars=100)

        assert len(summary) <= 100

    def test_extract_summary_stops_at_next_header(self) -> None:
        """Test summary extraction stops at next header."""
        output = """
## Summary

Summary line 1.
Summary line 2.

## Next Section

This should not be included.
"""
        summary = extract_summary(output)

        assert "Summary line" in summary
        assert "should not be included" not in summary

    def test_extract_summary_whitespace_only_lines(self) -> None:
        """Test handling whitespace-only lines."""
        output = """
Line 1

Line 2


Line 3
"""
        summary = extract_summary(output)

        # Should have content
        assert "Line" in summary


class TestExtractJson:
    """Tests for extract_json function."""

    def test_extract_json_basic(self) -> None:
        """Test extracting basic JSON from output."""
        output = """
Some text before.

```json
{"success": true, "summary": "Task completed"}
```

Some text after.
"""
        result = extract_json(output)

        assert result is not None
        assert result["success"] is True
        assert result["summary"] == "Task completed"

    def test_extract_json_nested_object(self) -> None:
        """Test extracting nested JSON objects."""
        output = """
```json
{
  "success": true,
  "plan_type": "feature",
  "checks": {
    "tests": {"passed": true},
    "lint": {"passed": true}
  }
}
```
"""
        result = extract_json(output)

        assert result is not None
        assert result["success"] is True
        assert result["checks"]["tests"]["passed"] is True

    def test_extract_json_array(self) -> None:
        """Test extracting JSON with arrays."""
        output = """
```json
{
  "issues": [
    {"severity": "major", "message": "Issue 1"},
    {"severity": "minor", "message": "Issue 2"}
  ]
}
```
"""
        result = extract_json(output)

        assert result is not None
        assert len(result["issues"]) == 2
        assert result["issues"][0]["severity"] == "major"

    def test_extract_json_multiple_blocks_uses_last(self) -> None:
        """Test that multiple JSON blocks returns the last one."""
        output = """
First block:
```json
{"version": 1, "status": "started"}
```

Second block:
```json
{"version": 2, "status": "completed"}
```
"""
        result = extract_json(output)

        assert result is not None
        assert result["version"] == 2
        assert result["status"] == "completed"

    def test_extract_json_empty_input(self) -> None:
        """Test extracting from empty input."""
        assert extract_json("") is None
        assert extract_json("   ") is None

    def test_extract_json_no_json_block(self) -> None:
        """Test extracting when no JSON block exists."""
        output = """
Some text without JSON.
More text.
"""
        assert extract_json(output) is None

    def test_extract_json_invalid_json(self) -> None:
        """Test extracting invalid JSON returns None."""
        output = """
```json
{invalid json: not valid}
```
"""
        assert extract_json(output) is None

    def test_extract_json_skill_output_format(self) -> None:
        """Test extracting JSON in typical skill output format."""
        output = """
I have completed the analysis. Here are the results:

```json
{
  "success": true,
  "plan_type": "chore",
  "summary": "Update README with documentation",
  "milestone_count": 2,
  "task_count": 5,
  "complexity": "medium",
  "document_path": "agentic/outputs/workflow-123/plan.md"
}
```

The plan has been saved to the output directory.
"""
        result = extract_json(output)

        assert result is not None
        assert result["success"] is True
        assert result["plan_type"] == "chore"
        assert result["summary"] == "Update README with documentation"
        assert result["milestone_count"] == 2
