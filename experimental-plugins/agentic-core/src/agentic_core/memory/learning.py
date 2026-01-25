"""Learning extraction from workflows."""

from dataclasses import dataclass
from typing import Optional

from agentic_core.memory.manager import MemoryManager
from agentic_core.providers import get_provider


@dataclass
class ExtractedLearning:
    """A learning extracted from a workflow."""

    category: str
    content: str
    confidence: float
    source_step: Optional[str] = None


class LearningExtractor:
    """Extracts learnings from workflow executions."""

    EXTRACTION_PROMPT = """Analyze this workflow execution and extract valuable learnings.

## Workflow Information
Name: {workflow_name}
Type: {workflow_type}
Status: {status}

## Step Outputs
{step_outputs}

## Messages
{messages}

---

Extract learnings in these categories:
1. **Lessons**: What went wrong and how to avoid it
2. **Patterns**: Successful approaches worth reusing
3. **Errors**: Common errors and their solutions
4. **Decisions**: Key decisions made and their rationale

For each learning, provide:
- Category (lesson/pattern/error/decision)
- Content (clear, actionable description)
- Confidence (0.0-1.0)
- Source step (if applicable)

Format your response as JSON:
```json
{{
  "learnings": [
    {{
      "category": "lesson",
      "content": "Description of the learning",
      "confidence": 0.9,
      "source_step": "step_name"
    }}
  ]
}}
```
"""

    def __init__(
        self,
        memory_manager: MemoryManager,
        provider: str = "claude",
        model: str = "haiku",
    ):
        """Initialize learning extractor.

        Args:
            memory_manager: Memory manager for storing learnings
            provider: AI provider for extraction
            model: Model to use for extraction
        """
        self.memory_manager = memory_manager
        self.provider = get_provider(provider)
        self.model = model

    async def extract_from_workflow(
        self,
        workflow_name: str,
        workflow_type: str,
        status: str,
        step_outputs: dict[str, str],
        messages: list[str] = None,
        workflow_id: Optional[str] = None,
    ) -> list[ExtractedLearning]:
        """Extract learnings from a completed workflow.

        Args:
            workflow_name: Name of the workflow
            workflow_type: Type of workflow
            status: Final status
            step_outputs: Dict of step name to output content
            messages: List of messages from the workflow
            workflow_id: Workflow ID for reference

        Returns:
            List of extracted learnings
        """
        if not self.memory_manager.enabled:
            return []

        # Format step outputs
        outputs_text = "\n".join(
            f"### {name}\n{content[:1000]}..." if len(content) > 1000 else f"### {name}\n{content}"
            for name, content in step_outputs.items()
        )

        # Format messages
        messages_text = "\n".join(messages[:20]) if messages else "No messages"

        # Build prompt
        prompt = self.EXTRACTION_PROMPT.format(
            workflow_name=workflow_name,
            workflow_type=workflow_type,
            status=status,
            step_outputs=outputs_text,
            messages=messages_text,
        )

        # Invoke AI to extract learnings
        result = self.provider.invoke(
            prompt=prompt,
            model=self.model,
            timeout=120,
            json_output=True,
        )

        if result.is_error:
            return []

        # Parse response
        learnings = self._parse_learnings(result.content)

        # Store learnings in memory
        for learning in learnings:
            if learning.confidence >= 0.7:  # Only store high-confidence learnings
                await self.memory_manager.store(
                    category=learning.category,
                    content=learning.content,
                    metadata={
                        "source": "workflow_extraction",
                        "workflow_name": workflow_name,
                        "workflow_id": workflow_id,
                        "confidence": learning.confidence,
                        "source_step": learning.source_step,
                    },
                    workflow_id=workflow_id,
                )

        return learnings

    def _parse_learnings(self, content: str) -> list[ExtractedLearning]:
        """Parse learnings from AI response."""
        import json
        import re

        learnings = []

        # Extract JSON from response
        json_match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                for item in data.get("learnings", []):
                    learnings.append(
                        ExtractedLearning(
                            category=item.get("category", "lesson"),
                            content=item.get("content", ""),
                            confidence=float(item.get("confidence", 0.5)),
                            source_step=item.get("source_step"),
                        )
                    )
            except (json.JSONDecodeError, KeyError, ValueError):
                pass

        # Fallback: try to parse direct JSON
        if not learnings:
            try:
                data = json.loads(content)
                for item in data.get("learnings", []):
                    learnings.append(
                        ExtractedLearning(
                            category=item.get("category", "lesson"),
                            content=item.get("content", ""),
                            confidence=float(item.get("confidence", 0.5)),
                            source_step=item.get("source_step"),
                        )
                    )
            except (json.JSONDecodeError, KeyError, ValueError):
                pass

        return learnings


async def extract_learnings(
    workflow_name: str,
    workflow_type: str,
    status: str,
    step_outputs: dict[str, str],
    memory_manager: MemoryManager,
    workflow_id: Optional[str] = None,
) -> list[ExtractedLearning]:
    """Convenience function to extract learnings from a workflow.

    Args:
        workflow_name: Name of the workflow
        workflow_type: Type of workflow
        status: Final status
        step_outputs: Dict of step name to output content
        memory_manager: Memory manager instance
        workflow_id: Workflow ID for reference

    Returns:
        List of extracted learnings
    """
    extractor = LearningExtractor(memory_manager)
    return await extractor.extract_from_workflow(
        workflow_name=workflow_name,
        workflow_type=workflow_type,
        status=status,
        step_outputs=step_outputs,
        workflow_id=workflow_id,
    )
