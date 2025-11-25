# Claude Code hook to format markdown files with Prettier after editing/creating
# This hook runs after Edit or Write tool calls on .md files

# Read JSON from stdin - use $Input automatic variable for pipeline input
$jsonInput = @($Input) -join "`n"
if (-not $jsonInput) {
    # Fallback to Console.In for direct stdin
    $jsonInput = [Console]::In.ReadToEnd()
}

$data = $jsonInput | ConvertFrom-Json

# Get the file path from the tool input
$filePath = $null
if ($data.tool_input.file_path) {
    $filePath = $data.tool_input.file_path
}

# Exit early if no file path or not a markdown file
if (-not $filePath -or -not $filePath.EndsWith(".md")) {
    exit 0
}

# Check if the file exists
if (-not (Test-Path $filePath)) {
    exit 0
}

# Format the file using npx prettier (uses VS Code's prettier config if available)
try {
    npx prettier --write $filePath 2>$null
} catch {
    # Silently fail - formatting is not critical
    exit 0
}
