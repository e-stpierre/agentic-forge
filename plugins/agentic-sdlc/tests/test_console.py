"""Tests for console output utilities."""

from __future__ import annotations

import io

from agentic_sdlc.console import (
    Color,
    ConsoleOutput,
    OutputLevel,
    _colorize,
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

        console.step_start("analyse-bugs", "prompt")

        output = stream.getvalue()
        assert "analyse-bugs" in output
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

    def test_stream_line_all_mode(self) -> None:
        """Test stream_line in ALL output mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.ALL, stream=stream)

        console.stream_line("streaming line")

        output = stream.getvalue()
        assert "streaming line" in output

    def test_stream_line_base_mode_silent(self) -> None:
        """Test stream_line is silent in BASE mode."""
        stream = io.StringIO()
        console = ConsoleOutput(level=OutputLevel.BASE, stream=stream)

        console.stream_line("streaming line")

        output = stream.getvalue()
        assert output == ""


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
