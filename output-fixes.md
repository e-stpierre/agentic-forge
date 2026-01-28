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

| File                                                           | Changes                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `plugins/agentic-sdlc/src/agentic_sdlc/console.py`             | Added accumulation, ANSI clearing, parallel mode, removed truncation |
| `plugins/agentic-sdlc/src/agentic_sdlc/steps/parallel_step.py` | Added enter/exit parallel mode calls                                 |
| `plugins/agentic-sdlc/tests/test_console.py`                   | Updated tests for new behavior, added new tests                      |

## Behavior Summary

| Mode     | Single Step                                              | Parallel Steps                                     |
| -------- | -------------------------------------------------------- | -------------------------------------------------- |
| **BASE** | Shows latest line with in-place updates, no user prompts | Streaming disabled, only completion messages shown |
| **ALL**  | Full streaming output with role indicators               | Full streaming output (may interleave)             |

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

## Additional Feature: Model Name Display

### Feature

Added model name display in `OutputLevel.ALL` mode to show which model is responding to each message. This is useful for workflows that use different models for different steps.

### Implementation

**1. Model Extraction (`runner.py`)**

Added `extract_model_from_message()` to extract model from stream-json messages:

```python
def extract_model_from_message(data: dict[str, Any]) -> str | None:
    """Extract model name from assistant or system messages."""
    msg_type = data.get("type")
    if msg_type == "assistant":
        message = data.get("message", {})
        return message.get("model")
    if msg_type == "system":
        return data.get("model")
    return None
```

**2. Model Formatting (`runner.py`)**

Added `format_model_name()` to convert long model names to friendly short versions:

```python
def format_model_name(model: str | None) -> str:
    """Format model name for display.

    Examples:
        "claude-sonnet-4-5-20250929" -> "sonnet-4.5"
        "claude-opus-4-5-20251101" -> "opus-4.5"
        "claude-3-7-sonnet-20250219" -> "sonnet-3.7"
    """
```

**3. Streaming Integration (`runner.py`)**

Updated the streaming loop to track and pass model information:

```python
# Track current model
current_model: str | None = None

# Extract model from assistant messages
model = extract_model_from_message(data)
if model:
    current_model = model

# Pass model to stream_text
console.stream_text(delta, role="assistant", model=current_model)
```

**4. Display in Console (`console.py`)**

Updated `stream_text()` to accept and display model:

```python
def stream_text(self, text: str, role: str = "assistant", model: str | None = None) -> None:
    """Stream text with optional model name display."""
    formatted_model = format_model_name(model) if model else None

    # For assistant messages in ALL mode
    if formatted_model:
        model_label = " " + _colorize(f"[{formatted_model}]", Color.DIM)

    # Display: * [sonnet-4.5] Message text...
```

### Output Example

```
* [sonnet-4.5] I'll help you with that task...
  This is the continuation of the message.

* [opus-4.5] Here's a more detailed analysis...
```

### Test Coverage

Added comprehensive tests:

- `TestExtractModelFromMessage` (4 tests)
- `TestFormatModelName` (6 tests)

All 311 tests pass with the new functionality.

## Additional Fixes: ALL Mode Output Issues

### Issue #1: Parallel Output Mixing

**Problem:** In `OutputLevel.ALL` mode with parallel steps, messages from different branches were interleaved line-by-line, making the output unreadable.

**Solution:** Implemented message buffering by branch:

1. **Message Buffering (`console.py`)**
   - Added `_parallel_buffer` to store messages by branch name
   - Added `_all_accumulated_text`, `_all_accumulated_role`, `_all_accumulated_model` to accumulate complete messages during streaming
   - Added `set_parallel_branch(branch_name)` to set the current branch context
   - Added `flush_parallel_branch(branch_name)` to display all buffered messages for a completed branch

2. **Streaming Accumulation (`console.py:stream_text()`)**
   - When in parallel mode AND ALL mode, accumulate text instead of printing immediately
   - Store accumulated messages in buffer when `stream_complete()` is called

3. **Branch Context (`parallel_step.py`)**
   - Call `console.set_parallel_branch(branch_step.name)` before executing each branch
   - Call `console.flush_parallel_branch(branch_step.name)` after branch completes
   - Messages are displayed as complete blocks with branch identification: `[branch-name] * message...`

**Output Example:**

```
[INFO] Parallel: starting 2 branches

[create-demo-1] > [user]
  Create a file named `demo-1.md` at the repository root...

[create-demo-1] * [haiku-4.5] I'll create the demo file at the repository root...

[create-demo-2] > [user]
  Create a file named `demo-2.md` at the repository root...

[create-demo-2] * [haiku-4.5] I'll create the `demo-2.md` file...
```

### Issue #2: Duplicate Step Summaries

**Problem:** Step completion summaries were displayed twice - once during streaming and again in the `[OK] step completed` message.

**Solution:** Modified `step_complete()` to only show summaries in BASE mode:

```python
def step_complete(self, step_name: str, summary: str | None = None) -> None:
    """Print step completion with optional summary.

    In ALL mode, skip the summary since full output was already streamed.
    In BASE mode, show the summary as it provides the only visible output.
    """
    check = _colorize("[OK]", Color.BRIGHT_GREEN)
    name = _colorize(step_name, Color.GREEN)
    self._print(f"{check} {name} completed")

    # Only show summary in BASE mode - in ALL mode, full output was already streamed
    if summary and self.level == OutputLevel.BASE:
        # ... show summary
```

**Result:**

- In ALL mode: `[OK] step_name completed` (no duplicate summary)
- In BASE mode: `[OK] step_name completed` with summary (as before)

### Issue #3: Ralph Loop Duplicate Summaries

**Problem:** Ralph loop iterations also displayed duplicate summaries after the fix for regular steps.

**Solution:** Applied the same fix to `ralph_iteration()`:

```python
def ralph_iteration(self, step_name: str, iteration: int, max_iterations: int, summary: str | None = None) -> None:
    """Print Ralph loop iteration progress.

    In ALL mode, skip the summary since full output was already streamed.
    In BASE mode, show the summary as it provides the only visible output.
    """
    progress = _colorize(f"[{iteration}/{max_iterations}]", Color.CYAN)
    name = _colorize(step_name, Color.CYAN)
    self._print(f"{progress} {name} iteration")

    # Only show summary in BASE mode - in ALL mode, full output was already streamed
    if summary and self.level == OutputLevel.BASE:
        # ... show summary
```

**Result:**

- In ALL mode: `[3/5] step_name iteration` (no duplicate summary)
- In BASE mode: `[3/5] step_name iteration` with summary (as before)

## Additional Fix: Ralph Loop Output in BASE Mode

### Issue

In BASE mode, ralph-loop iterations displayed both intermediate streaming messages (`- ...` prefix) AND the iteration summary. This caused duplicate/verbose output:

```
Step: random-facts-loop [ralph-loop]
[INFO] Ralph loop starting (max 5 iterations)
  - I'll start by reading the file `demo-1.md`...
  - The file currently has no Random Facts section...
  - Done. I've added the first random fact...
[1/5] random-facts-loop iteration
    Done. I've added the first random fact...
```

### Solution

Removed the printing from `stream_complete()` in BASE mode entirely. The summary is already shown by `step_complete()` or `ralph_iteration()` at the end of each step/iteration, so printing from `stream_complete()` was redundant.

### Code Changes

```python
def stream_complete(self) -> None:
    """Called when streaming is complete to finalize output.

    In BASE mode, does not print anything - the summary is shown by
    step_complete() or ralph_iteration() methods instead.
    In ALL mode with parallel, buffers the complete message.
    Resets internal state for next stream.
    """
    # In BASE mode, don't print intermediate messages - the summary will be
    # shown by step_complete() or ralph_iteration() at the end
```

### Result

In BASE mode, only the step completion messages with summaries are shown:

```
Step: random-facts-loop [ralph-loop]
[INFO] Ralph loop starting (max 5 iterations)
[1/5] random-facts-loop iteration
    Done. I've added the first random fact...
[2/5] random-facts-loop iteration
    Perfect! I've successfully added the second random fact...
```

This matches the expected "only summary at the end" behavior for BASE mode.

## Future Considerations

1. **Tool subtexts**: Would require changes to Claude Code CLI to expose these in stream-json format
2. **Per-branch output in parallel mode**: Could add branch-prefixed output instead of suppressing entirely
3. **Terminal width detection**: Could add dynamic truncation based on actual terminal width if needed
