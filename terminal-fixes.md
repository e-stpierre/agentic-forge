## Base output overwrite attempt (ralph loop)

- Attempted fix in `ConsoleOutput` to clear the previous Ralph iteration header+message block before printing the next iteration header and to track iteration line counts during streaming.
- Added `_base_last_iteration_lines` and `_base_iteration_active` to manage per-iteration in-place clearing in BASE mode.
- Result: did not resolve the issue; prior iteration output still persists instead of being overwritten.
- Suspected cause: ANSI cursor movement/clear sequences are not reliably applied in the current terminal (PowerShell/Windows), so the clear step is ineffective even when line counts are tracked.
