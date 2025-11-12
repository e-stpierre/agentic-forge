# Development Plugin

Comprehensive development toolkit for Claude Code that accelerates feature implementation through intelligent codebase analysis, interactive requirement gathering, and automated planning.

## Overview

The Development plugin provides tools to help you plan and implement new features systematically. It combines automated codebase exploration with interactive requirement clarification to produce detailed, actionable implementation plans that coding agents can follow.

## Features

### Intelligent Codebase Analysis
- **Parallel Exploration**: Launches 3 specialized Explore agents simultaneously to analyze your codebase from different perspectives
- **Architecture Understanding**: Identifies project structure, patterns, and conventions
- **Feature Context Discovery**: Finds related code, integration points, and affected components
- **Dependency Mapping**: Identifies reusable utilities, libraries, and existing patterns

### Interactive Requirement Gathering
- **Smart Questioning**: Asks 0-20 targeted clarifying questions based on feature complexity
- **Recommended Answers**: Provides suggested options for common decisions
- **Paginated Interface**: Breaks complex requirements into digestible pages of 4 questions
- **Flexible Input**: Allows users to skip questions or defer decisions

### Comprehensive Planning
- **Detailed Implementation Plans**: Creates markdown documents with complete implementation instructions
- **Milestone Support**: Breaks large features into manageable phases
- **Actionable Steps**: Includes specific file paths, code references, and step-by-step guidance
- **Testing Strategy**: Incorporates test planning into implementation plans
- **No Project Management Overhead**: Focuses purely on technical implementation details

## Components

### Command: /plan-dev

Creates comprehensive feature implementation plans through codebase analysis and interactive requirement gathering.

**Path**: `plugins/development/commands/plan-dev.md`

## Installation

### Marketplace Installation (Recommended)

Install via the Claude Code plugin marketplace:

1. Add the claude-plugins marketplace (if not already added):
```bash
/plugin marketplace add e-stpierre/claude-plugins
```

2. Install the Development plugin:
```bash
/plugin install development@e-stpierre/claude-plugins
```

Or use the interactive menu:
```bash
/plugin menu
```

**For private repositories**: Ensure you have proper Git authentication configured (SSH keys or GitHub personal access token).

### Manual Installation (Alternative)

If you prefer manual installation or want to customize the plugin:

1. Copy the command to your project:
```bash
mkdir -p .claude/commands
cp plugins/development/commands/plan-dev.md .claude/commands/
```

## Usage

### Basic Feature Planning

Plan a new feature by providing a description:

```
/plan-dev
```

Then describe your feature when prompted:
```
I want to add user authentication with email and password
```

This will:
1. Launch 3 Explore agents to analyze your codebase in parallel
2. Synthesize findings to understand your project structure
3. Ask clarifying questions about requirements and implementation details
4. Create a comprehensive implementation plan
5. Save the plan to your specified location (default: `/docs/plans/`)

### Planning Process Flow

#### Step 1: Feature Description
```
/plan-dev

> Please describe the feature you want to implement:

User: I want to add a real-time notification system for user messages
```

#### Step 2: Codebase Analysis
```
Analyzing your codebase with 3 specialized agents...

✓ Agent 1: Architecture Analysis (completed)
✓ Agent 2: Feature-Related Code Discovery (completed)
✓ Agent 3: Dependencies & Integration Points (completed)

Synthesis complete. I've identified:
- Project uses React + Node.js with WebSocket support
- Existing notification components in src/components/notifications/
- Socket.io already configured for real-time features
- Similar patterns in src/features/chat/
```

#### Step 3: Clarifying Questions
```
I have 12 clarifying questions to help create a complete implementation plan.
These will be presented in 3 pages of 4 questions each.

--- Page 1 of 3 ---

## Question 1: Notification Types

**Context**: Determines what data structures and UI components are needed

**Recommended Options**:
a) Text-only notifications (simple, fastest to implement)
b) Rich notifications with actions (e.g., "View Message" button)
c) Full multimedia support (images, files, etc.)
d) Other (please specify)

**Your Answer**: b

## Question 2: Notification Persistence

**Context**: Affects storage requirements and complexity

**Recommended Options**:
a) Ephemeral (only while user is online)
b) Store in database for retrieval
c) Hybrid (recent notifications persist, older ones expire)
d) Other (please specify)

**Your Answer**: b

[... 2 more questions ...]

Ready for the next set of questions? (yes/no): yes
```

#### Step 4: Plan Generation
```
Creating comprehensive implementation plan...

✓ Plan structure defined
✓ Files to create: 8
✓ Files to modify: 12
✓ Milestones: 3
✓ Testing strategy included

Where would you like to save this plan?

Default location: /docs/plans/real-time-notification-system-plan.md
[Press enter for default or provide custom path]: [enter]

✓ Plan saved to /docs/plans/real-time-notification-system-plan.md
```

#### Step 5: Summary
```
## Implementation Plan Created ✓

**Plan Location**: /docs/plans/real-time-notification-system-plan.md

**Summary**:
- Feature: Real-time notification system for user messages
- Milestones: 3 (Backend Infrastructure, Frontend Components, Integration & Testing)
- Files to create: 8
- Files to modify: 12
- Estimated complexity: Medium

**Next Steps**:
1. Review the plan for accuracy and completeness
2. Use the plan to implement the feature
3. Follow the validation checklist

Would you like me to:
- Start implementing this plan?
- Revise any part of the plan?
- Create a GitHub issue from this plan?
```

## What Gets Generated

### Implementation Plan Structure

The generated plan includes:

#### Overview
- Clear feature description
- High-level approach
- Key architectural decisions

#### Prerequisites
- Required dependencies
- Setup steps
- Access requirements

#### Feature Requirements
- Complete list of functional requirements
- Non-functional requirements
- Acceptance criteria

#### Architecture & Design Decisions
- Key technical decisions
- Rationale for each decision
- Alternatives considered

#### Implementation Details (per Milestone)
- **Files to Create**: Full paths with purpose and key components
- **Files to Modify**: Specific changes needed with line references
- **Implementation Steps**: Ordered, actionable steps with details
- **Code References**: Links to existing patterns to follow

#### Testing Strategy
- Unit test locations and cases
- Integration test scenarios
- Manual testing checklist

#### Edge Cases & Error Handling
- Identified edge cases with handling approach
- Error conditions with messages and recovery

#### Security Considerations
- Security implications
- Mitigation strategies
- Best practices to follow

#### Performance Considerations
- Performance-critical areas
- Optimization approaches
- Monitoring recommendations

#### Documentation Updates
- Files to update
- What to document
- API documentation changes

#### Validation Checklist
- Completion criteria
- Quality checks
- Review points

## Example Implementation Plan

Here's an excerpt from a generated plan:

```markdown
# Feature Implementation Plan: Dark Mode Toggle

## Overview
Implement a user-configurable dark mode toggle in the application settings
that persists user preference and applies theme consistently across all components.

## Prerequisites
- CSS variables or styled-components theme provider
- Local storage or user preference API
- React Context or state management setup

## Feature Requirements
- User can toggle dark mode on/off from settings page
- Preference persists across sessions
- Theme applies immediately without page reload
- All components respect theme setting
- Default to system preference on first visit

## Architecture & Design Decisions

**Decision 1: Use CSS Variables for Theming**
- Rationale: Allows dynamic theme switching without CSS-in-JS overhead
- Alternative: styled-components ThemeProvider (more complex)

**Decision 2: Store Preference in localStorage**
- Rationale: Simple, works offline, no backend changes needed
- Alternative: User profile API (requires authentication)

## Implementation Details

### Milestone 1: Theme Infrastructure

#### Files to Create

1. **`src/styles/themes.css`**
   - Purpose: Define CSS variables for light and dark themes
   - Key components: :root[data-theme="light/dark"] with color variables
   - Dependencies: None

2. **`src/contexts/ThemeContext.tsx`**
   - Purpose: Provide theme state and toggle function app-wide
   - Key components: ThemeProvider, useTheme hook
   - Dependencies: React, localStorage API

#### Files to Modify

1. **`src/App.tsx`**
   - Changes needed: Wrap app with ThemeProvider
   - Lines affected: Line 10-15 (component wrapping)
   - Reason: Enable theme context throughout app

2. **`src/index.css`**
   - Changes needed: Import themes.css and use CSS variables
   - Lines affected: Replace hardcoded colors with var(--color-*)
   - Reason: Make existing styles theme-aware

#### Implementation Steps

1. Create CSS variable definitions for both themes
   - Details: Define --color-background, --color-text, --color-primary, etc.
   - Considerations: Ensure sufficient contrast ratios for accessibility

2. Implement ThemeContext with localStorage persistence
   - Details: Create context with theme state, toggle function, and localStorage sync
   - Related code: See StateContext pattern in src/contexts/AuthContext.tsx:15-45

3. Detect system preference on initial load
   - Details: Use window.matchMedia('(prefers-color-scheme: dark)')
   - Considerations: Only use system preference if no saved preference exists

### Milestone 2: Settings UI

#### Files to Create

1. **`src/components/settings/ThemeToggle.tsx`**
   - Purpose: UI component for theme toggle switch
   - Key components: Toggle button with light/dark icons
   - Dependencies: ThemeContext, UI library components

[... continues with complete implementation details ...]

## Testing Strategy

### Unit Tests

- Test file: `src/contexts/ThemeContext.test.tsx`
- Test cases:
  - Theme toggles between light and dark
  - Preference saves to localStorage
  - System preference detected on first load
  - Invalid localStorage values handled gracefully

### Integration Tests

- Settings page renders theme toggle
- Toggle immediately updates theme across components
- Theme persists after page reload

### Manual Testing

- [ ] Toggle works in settings page
- [ ] All components render correctly in both themes
- [ ] Preference persists across browser sessions
- [ ] System preference detected initially
- [ ] Theme transitions smoothly

## Edge Cases & Error Handling

- **Edge Case: localStorage unavailable** → Fall back to in-memory state, show warning
- **Edge Case: Invalid theme value** → Default to light theme, log error
- **Error: CSS variables not supported** → Show warning about limited browser support

## Security Considerations

- Sanitize theme value before applying to prevent CSS injection
- Validate localStorage values before using
- No sensitive data stored in theme preference

## Performance Considerations

- Use CSS variables to avoid re-rendering on theme change
- Debounce theme toggle to prevent rapid switches
- Lazy load theme-specific images only when needed

## Documentation Updates

- [ ] Update README.md with theme customization guide
- [ ] Add JSDoc comments to ThemeContext
- [ ] Document CSS variable naming convention

## Validation Checklist

- [ ] Theme toggle works in all browsers
- [ ] Accessibility (color contrast, keyboard navigation)
- [ ] Performance (no layout thrashing)
- [ ] Code follows project conventions
- [ ] Tests passing
- [ ] Documentation updated

## Notes for Implementation

- Follow existing patterns in src/contexts/ for context structure
- Use icons from the project's icon library (src/components/icons/)
- Ensure smooth transitions by adding CSS transition rules
- Consider adding more themes in the future (design extensibly)

## References

- Existing context pattern: `src/contexts/AuthContext.tsx:15-45`
- Toggle component example: `src/components/ui/Toggle.tsx`
- Theme documentation: `docs/styling-guide.md`
```

## Advanced Usage

### Custom Plan Location

Specify where to save the plan:

```
/plan-dev

[After questions are answered]

> Where would you like to save this plan?
> Default: /docs/plans/feature-name-plan.md

User: /project-docs/features/my-feature.md
```

### Skipping Questions

You can skip questions or ask the agent to decide:

```
> Question 5: Should notifications be dismissible?

User: Use your best judgment

✓ Understood. I'll make notifications dismissible as this is standard UX practice.
```

### Implementing from a Plan

After creating a plan, ask Claude Code to implement it:

```
Please implement the plan you just created at /docs/plans/dark-mode-toggle-plan.md
```

Claude will use the plan as a detailed guide for implementation.

## Best Practices

### When to Use /plan-dev

**Good Use Cases**:
- Adding new features to existing codebase
- Refactoring complex systems
- Implementing cross-cutting concerns
- Integrating third-party services
- Building multi-component features

**Not Ideal For**:
- Simple bug fixes (just fix directly)
- Trivial additions (one-line changes)
- Experimental prototyping (too rigid)
- Well-documented features (follow existing docs)

### Getting Better Plans

1. **Provide Context**: Describe not just what you want, but why
2. **Be Specific**: "Add authentication" vs "Add JWT-based authentication with refresh tokens"
3. **Answer Thoughtfully**: Take time to consider questions carefully
4. **Review Before Implementation**: Plans aren't perfect, review and adjust
5. **Iterate**: If the plan misses something, run /plan-dev again with refinements

### Working with Generated Plans

1. **Read Thoroughly**: Review the entire plan before starting
2. **Validate Assumptions**: Check that agent understood your codebase correctly
3. **Adjust as Needed**: Plans are starting points, not commandments
4. **Keep Updated**: Update the plan if implementation diverges
5. **Learn Patterns**: Use plans to understand your codebase better

## How It Works

### Three-Agent Codebase Analysis

The /plan-dev command uses three specialized Explore agents running in parallel:

1. **Architecture Agent**: Understands overall project structure and conventions
2. **Feature Agent**: Finds related code and integration points
3. **Dependency Agent**: Identifies reusable utilities and patterns

This parallel approach provides:
- **Speed**: 3x faster than sequential exploration
- **Breadth**: Multiple perspectives on the codebase
- **Depth**: Thorough understanding of context

### Intelligent Question Generation

Questions are generated based on:
- Feature complexity
- Identified uncertainties from codebase analysis
- Common decision points for similar features
- Project-specific considerations

Questions include:
- Context explaining why it matters
- Recommended answer options
- Flexibility to skip or provide custom answers

### Plan Generation

The plan is created by:
1. Synthesizing codebase analysis results
2. Incorporating user answers to clarifying questions
3. Identifying files to create/modify
4. Ordering implementation steps logically
5. Adding testing, security, and performance considerations
6. Providing validation checklist

## Limitations

The Development plugin:
- ✅ Analyzes static codebase structure and patterns
- ✅ Generates detailed implementation plans
- ✅ Identifies related code and dependencies
- ✅ Suggests implementation approach
- ❌ Cannot run code or tests during analysis
- ❌ May miss runtime behavior or dynamic patterns
- ❌ Plans require human review and validation
- ❌ Cannot predict all implementation challenges

## Troubleshooting

### Agent Takes Too Long
- **Issue**: Explore agents running slowly
- **Solution**: Codebase might be very large; consider specifying focused directories

### Questions Not Relevant
- **Issue**: Clarifying questions don't apply to your feature
- **Solution**: Skip irrelevant questions, agent adapts

### Plan Missing Details
- **Issue**: Generated plan lacks specific information
- **Solution**: Run /plan-dev again with more specific feature description

### Plan Doesn't Match Codebase
- **Issue**: Plan suggests patterns not used in your project
- **Solution**: Agents may have misunderstood; provide feedback and regenerate

## Contributing

Have ideas to improve the Development plugin?

1. Fork the repository
2. Enhance the plan-dev command or add new development commands
3. Test with various project types and feature complexities
4. Submit a pull request with examples

## Future Enhancements

Planned improvements:
- Additional development commands (refactor-plan, test-plan, etc.)
- Custom question templates for specific feature types
- Plan templates for common patterns
- Integration with project management tools
- Team collaboration features

## Resources

### Feature Planning Best Practices
- [Requirements Engineering](https://en.wikipedia.org/wiki/Requirements_engineering)
- [Software Design Patterns](https://refactoring.guru/design-patterns)
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

### Development Process
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
- [Refactoring Techniques](https://refactoring.guru/refactoring)
- [Code Review Best Practices](https://google.github.io/eng-practices/review/)

## License

This plugin is part of the claude-plugins repository and is licensed under the MIT License.

## Support

For issues, questions, or contributions:
- Open an issue in the [claude-plugins repository](https://github.com/e-stpierre/claude-plugins)
- Join the community discussions
- Check the documentation in `/docs/`

---

**Note**: Implementation plans are starting points for development, not complete specifications. Always review plans carefully and adapt them to your specific needs and constraints.
