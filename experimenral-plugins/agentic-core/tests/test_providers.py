"""Tests for CLI providers."""

import pytest

from agentic_core.providers import (
    ClaudeProvider,
    CursorProvider,
    MockProvider,
    get_provider,
    list_providers,
)


class TestProviderRegistry:
    """Tests for provider registry."""

    def test_list_providers(self):
        """Test listing available providers."""
        providers = list_providers()
        assert "claude" in providers
        assert "cursor" in providers
        assert "mock" in providers

    def test_get_provider_claude(self):
        """Test getting Claude provider."""
        provider = get_provider("claude")
        assert isinstance(provider, ClaudeProvider)
        assert provider.name == "claude"

    def test_get_provider_cursor(self):
        """Test getting Cursor provider."""
        provider = get_provider("cursor")
        assert isinstance(provider, CursorProvider)
        assert provider.name == "cursor"

    def test_get_provider_mock(self):
        """Test getting Mock provider."""
        provider = get_provider("mock")
        assert isinstance(provider, MockProvider)
        assert provider.name == "mock"

    def test_get_provider_invalid(self):
        """Test getting invalid provider raises error."""
        with pytest.raises(ValueError, match="Unknown provider"):
            get_provider("invalid")


class TestClaudeProvider:
    """Tests for Claude provider."""

    def test_build_command_basic(self):
        """Test building basic command returns tuple (cmd, stdin)."""
        provider = ClaudeProvider()
        cmd, stdin = provider.build_command("Hello")
        assert cmd == ["claude", "--print", "--output-format", "json"]
        assert stdin == "Hello"

    def test_build_command_with_model(self):
        """Test building command with model."""
        provider = ClaudeProvider()
        cmd, stdin = provider.build_command("Hello", model="opus")
        assert "--model" in cmd
        assert "opus" in cmd
        assert stdin == "Hello"

    def test_build_command_with_session(self):
        """Test building command with session."""
        provider = ClaudeProvider()
        cmd, stdin = provider.build_command("Hello", session_id="abc123")
        assert "--resume" in cmd
        assert "abc123" in cmd
        assert stdin == "Hello"

    def test_build_command_with_system_prompt(self):
        """Test building command with system prompt."""
        provider = ClaudeProvider()
        cmd, stdin = provider.build_command("Hello", system_prompt="You are helpful")
        assert "--append-system-prompt" in cmd
        assert "You are helpful" in cmd
        assert stdin == "Hello"

    def test_build_command_with_tools(self):
        """Test building command with tools."""
        provider = ClaudeProvider()
        cmd, stdin = provider.build_command("Hello", tools=["read", "write"])
        assert "--allowedTools" in cmd
        assert "read,write" in cmd
        assert stdin == "Hello"

    def test_parse_output_success(self):
        """Test parsing successful JSON output."""
        provider = ClaudeProvider()
        stdout = (
            '{"type":"result","subtype":"success","is_error":false,'
            '"result":"Hello!","session_id":"abc123",'
            '"usage":{"input_tokens":10,"output_tokens":5}}'
        )
        result = provider.parse_output(stdout, "", 0, 100)

        assert result.content == "Hello!"
        assert result.session_id == "abc123"
        assert result.tokens_in == 10
        assert result.tokens_out == 5
        assert not result.is_error

    def test_parse_output_error(self):
        """Test parsing error output."""
        provider = ClaudeProvider()
        result = provider.parse_output("", "Error message", 1, 100)

        assert result.is_error
        assert "Error message" in result.error_message

    def test_capabilities(self):
        """Test provider capabilities."""
        provider = ClaudeProvider()
        assert provider.capabilities.session_resume is True
        assert provider.capabilities.json_output is True
        assert provider.capabilities.tool_restrictions is True


class TestCursorProvider:
    """Tests for Cursor provider."""

    def test_build_command_basic(self):
        """Test building basic command returns tuple (cmd, stdin)."""
        provider = CursorProvider()
        cmd, stdin = provider.build_command("Hello")
        assert cmd[0] == "cursor-agent"
        assert "--print" in cmd
        assert stdin == "Hello"

    def test_build_command_with_system_prompt(self):
        """Test system prompt is embedded in stdin prompt."""
        provider = CursorProvider()
        cmd, stdin = provider.build_command("Hello", system_prompt="You are helpful")
        # System prompt should be embedded in the stdin prompt
        assert "You are helpful" in stdin
        assert "Hello" in stdin

    def test_capabilities(self):
        """Test provider capabilities."""
        provider = CursorProvider()
        assert provider.capabilities.session_resume is True
        assert provider.capabilities.json_output is True
        assert provider.capabilities.tool_restrictions is False


class TestMockProvider:
    """Tests for Mock provider."""

    def test_invoke_returns_response(self):
        """Test mock provider returns a response."""
        provider = MockProvider(latency_ms=0)
        result = provider.invoke("Hello")

        assert not result.is_error
        assert result.content
        assert result.session_id

    def test_invoke_tracks_session(self):
        """Test mock provider tracks session history."""
        provider = MockProvider(latency_ms=0)
        result1 = provider.invoke("First prompt")
        session_id = result1.session_id

        provider.invoke("Second prompt", session_id=session_id)

        history = provider.get_session_history(session_id)
        assert len(history) == 2
        assert "First prompt" in history
        assert "Second prompt" in history

    def test_invoke_with_custom_response(self):
        """Test mock provider with custom response function."""
        provider = MockProvider(latency_ms=0, response_fn=lambda p: f"Custom: {p}")
        result = provider.invoke("Test")

        assert result.content == "Custom: Test"

    def test_invoke_bug_fix_response(self):
        """Test mock provider returns bug fix response for bug-related prompts."""
        provider = MockProvider(latency_ms=0)
        result = provider.invoke("Fix the login bug")

        assert "fix" in result.content.lower() or "bug" in result.content.lower()

    def test_invoke_plan_response(self):
        """Test mock provider returns plan response for planning prompts."""
        provider = MockProvider(latency_ms=0)
        result = provider.invoke("Create a plan for the feature")

        assert "plan" in result.content.lower() or "task" in result.content.lower()

    def test_health_check_always_true(self):
        """Test mock provider health check always returns True."""
        provider = MockProvider()
        assert provider.health_check() is True

    def test_capabilities(self):
        """Test provider capabilities."""
        provider = MockProvider()
        assert provider.capabilities.session_resume is True
        assert provider.capabilities.json_output is True
        assert provider.capabilities.tool_restrictions is True
