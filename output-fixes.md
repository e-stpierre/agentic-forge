# Terminal Output Improvements - Analysis and Fixes

## Overview

This document summarizes the investigation and fixes made to improve the terminal output streaming in the `agentic-sdlc` plugin, specifically for the `base` output mode.

## Initial Issues

Two main issues were identified with `terminal-output: "base"` mode:

1. **Multiple messages displayed instead of single line**: Each streaming delta was printed on a new line instead of overwriting the previous output
2. **Line truncation at 120 characters**: Long messages were being cut off

Additionally, the user requested:
- Hide user prompts in BASE mode (only show assistant output)
- Investigate if Claude's tool subtexts could be captured and streamed

## Investigation Findings

### Tool Subtexts

After examining the Claude CLI stream-json output format (with `--output-format stream-json --verbose`), I found that **tool subtexts are not available** in the streaming API. The stream-json format only includes:

- `system` - initialization info
- `assistant` - complete messages with text/tool_use content
- `user` - tool results
- `result` - final result

The status subtexts shown during tool execution in Claude Code's interactive terminal are a UI feature specific to the interactive mode and are not exposed in the streaming output.

### BASE Mode Output Issues

The original implementation called `stream_text()` for each delta and printed a new line each time. The fix required:
1. Accumulating text across streaming calls
2. Using ANSI escape codes to overwrite previous output
3. Handling parallel execution specially to avoid interleaved output

## Changes Made

### 1. Text Accumulation (`console.py`)

Added state tracking for BASE mode streaming:

```python
_base_accumulated_text: str = ""  # Accumulated text for BASE mode streaming
_base_line_printed: bool = False  # Whether a line is currently shown
_parallel_mode: bool = False  # Whether running in parallel
```

### 2. In-Place Line Updates (`console.py`)

Added `_clear_line()` method using ANSI escape codes:

```python
def _clear_line(self) -> None:
    if _supports_color():
        # \r = carriage return, \033[2K = clear entire line
        print("\r\033[2K", end="", flush=True, file=self.stream)
    else:
        print("", file=self.stream)
```

### 3. Updated `stream_text()` for BASE Mode

- User prompts are now skipped entirely in BASE mode
- Assistant messages accumulate and only show the last meaningful line
- Previous output is cleared before printing new content
- Line truncation was removed (full messages now displayed)

```python
elif self.level == OutputLevel.BASE:
    if role == "user":
        return  # Skip user prompts

    if self._parallel_mode:
        return  # Skip streaming in parallel mode

    # Accumulate and show last line with in-place updates
    self._base_accumulated_text += text
    # ... find last line, clear previous, print new
```

### 4. Updated `stream_complete()`

Properly finalizes output and resets state:

```python
def stream_complete(self) -> None:
    if self.level == OutputLevel.BASE and self._base_line_printed:
        print("", file=self.stream)  # Final newline

    # Reset state
    self._last_base_line_count = 0
    self._base_accumulated_text = ""
    self._base_line_printed = False
```

### 5. Parallel Execution Handling (`parallel_step.py`)

Added parallel mode to prevent interleaved output from concurrent threads:

```python
# Before executing branches
console.enter_parallel_mode()

# ... execute branches in ThreadPoolExecutor ...

# After all branches complete
console.exit_parallel_mode()
```

## Files Modified

| File | Changes |
|------|---------|
| `plugins/agentic-sdlc/src/agentic_sdlc/console.py` | Added accumulation, ANSI clearing, parallel mode, removed truncation |
| `plugins/agentic-sdlc/src/agentic_sdlc/steps/parallel_step.py` | Added enter/exit parallel mode calls |
| `plugins/agentic-sdlc/tests/test_console.py` | Updated tests for new behavior, added new tests |

## Behavior Summary

| Mode | Single Step | Parallel Steps |
|------|-------------|----------------|
| **BASE** | Shows latest line with in-place updates, no user prompts | Streaming disabled, only completion messages shown |
| **ALL** | Full streaming output with role indicators | Full streaming output (may interleave) |

## Test Coverage

All 295 tests pass. New tests added:
- `test_stream_text_base_mode_accumulates_text`
- `test_stream_text_base_mode_shows_latest_complete_line`
- `test_stream_complete_resets_state_for_new_stream`
- `test_stream_text_base_mode_handles_long_lines`
- `test_stream_text_base_mode_skips_user_prompts`

## Additional Fix: Remove In-Place Updates

### Issue

The in-place line update mechanism (using ANSI escape codes `\r\033[2K`) did not work reliably across all terminal environments (Windows, non-TTY, redirected output). This caused each intermediate streaming state to be printed on a new line, resulting in duplicate content like:

```
  - I'll start by reading the demo-1.md file to see its current sta
  - I'll start by reading the demo-1.md file to see its current state and check if there's...
  - I'll start by reading the demo-1.md file to see its current state and check if there's... Perfect!
```

### Solution

Simplified BASE mode streaming to accumulate text silently during streaming and only print the final message when streaming completes:

1. **`stream_text()`**: Now only accumulates text in `_base_accumulated_text` without printing anything
2. **`stream_complete()`**: Prints the final accumulated message with the last meaningful line

### Code Changes

```python
# stream_text() in BASE mode - now just accumulates
self._base_accumulated_text += text

# stream_complete() - prints the final message
if self.level == OutputLevel.BASE and self._base_accumulated_text:
    lines = self._base_accumulated_text.strip().split("\n")
    last_line = ""
    for line in reversed(lines):
        if line.strip():
            last_line = line.strip()
            break
    if last_line:
        self._print(f"  - {last_line}")
```

### Removed Code

- `_clear_line()` method (ANSI escape sequence clearing)
- `_base_line_printed` field (no longer needed)
- `_last_base_line_count` field (no longer needed)

This approach is simpler and works reliably across all terminal environments.

## Additional Fix: Windows Terminal User Message Color

### Issue

In Windows Terminal, user messages in `OutputLevel.ALL` mode were displayed in white (default terminal color) instead of green. Only the prefix and label were colored, but the message text itself was not.

### Solution

Applied `Color.GREEN` to user message text content in the `stream_text()` method to match the visual styling of other colored output.

### Code Changes

```python
# In stream_text() for OutputLevel.ALL mode, user role
for line in text.split("\n"):
    colored_line = _colorize(line, Color.GREEN)
    self._print(f"  {colored_line}")
```

This ensures consistent green coloring for user messages across all terminal environments, including Windows Terminal.

## Future Considerations

1. **Tool subtexts**: Would require changes to Claude Code CLI to expose these in stream-json format
2. **Per-branch output in parallel mode**: Could add branch-prefixed output instead of suppressing entirely
3. **Terminal width detection**: Could add dynamic truncation based on actual terminal width if needed
