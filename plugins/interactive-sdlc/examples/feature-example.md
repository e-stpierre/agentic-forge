# Feature: Dark Mode Support

## Overview

Add dark mode support to the application with a toggle in user settings and persistent user preference. Dark mode should respect system preferences by default but allow manual override.

## Requirements

**Functional:**

- Toggle switch in Settings > Appearance
- Persist preference in user profile
- Apply theme without page reload
- Respect system preference by default
- Override with manual selection

**Non-functional:**

- Theme switch must be instant (<100ms)
- No flash of wrong theme on page load
- Support for future additional themes
- Accessible contrast ratios (WCAG AA)

## Architecture

**Theme System:**

- CSS custom properties for all colors
- Theme context provider in React
- LocalStorage for instant load, API for persistence
- Media query listener for system preference changes

**Components affected:**

- AppShell (root theme provider)
- Settings page (new Appearance section)
- All components using hardcoded colors

**Data model:**

```typescript
interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
}
```

## Milestones

### Milestone 1: Theme Infrastructure

Set up the foundation for theming without visible changes.

#### Task 1.1: Create CSS custom properties

- Define color variables in `:root`
- Create `.dark` class variants
- Map semantic colors (--color-bg-primary, --color-text-primary, etc.)

#### Task 1.2: Create ThemeContext

- Create React context for theme state
- Implement useTheme hook
- Add provider to app root
- Handle system preference detection

#### Task 1.3: Add theme persistence

- Save preference to localStorage for instant load
- Sync preference to user profile API
- Load preference on app initialization

### Milestone 2: Dark Theme Design

Create the dark theme color palette and apply it.

#### Task 2.1: Design dark color palette

- Define dark theme colors
- Ensure WCAG AA contrast compliance
- Review with design team

#### Task 2.2: Apply theme to components

- Update AppShell with theme class
- Audit components for hardcoded colors
- Replace with CSS variables
- Test each component in both themes

#### Task 2.3: Handle images and icons

- Add dark mode variants for logo
- Ensure icons have sufficient contrast
- Handle user-uploaded images (consider filters)

### Milestone 3: Settings UI

Add user-facing controls for theme selection.

#### Task 3.1: Create Appearance settings section

- Add new section to Settings page
- Create theme toggle component
- Options: Light, Dark, System

#### Task 3.2: Implement theme switching

- Wire toggle to ThemeContext
- Persist selection on change
- Show current effective theme for "System" option

#### Task 3.3: Add system preference sync

- Listen for system preference changes
- Update theme when system changes (if set to System)
- Show notification on system change

### Milestone 4: Polish and Testing

Final refinements and comprehensive testing.

#### Task 4.1: Prevent flash of wrong theme

- Add blocking script in document head
- Set theme class before React hydration
- Test with slow network simulation

#### Task 4.2: Add transition animations

- Smooth color transitions on theme change
- Respect reduced-motion preference

#### Task 4.3: Comprehensive testing

- Test all pages in both themes
- Test theme persistence across sessions
- Test system preference changes
- Cross-browser testing

## Testing Strategy

**Unit tests:**

- ThemeContext state management
- useTheme hook behavior
- System preference detection

**Integration tests:**

- Theme toggle updates correctly
- Preference persists to localStorage and API
- Theme applies on page load

**E2E tests:**

- Full user flow: toggle theme, refresh, verify
- System preference change detection

**Visual regression:**

- Screenshot comparison for each page in both themes

## Validation Criteria

- Theme toggle visible in Settings > Appearance
- Selecting Dark/Light immediately changes theme
- Selecting System respects OS preference
- Preference persists after logout/login
- No flash of wrong theme on page load
- All text meets WCAG AA contrast requirements
- Theme switch completes in <100ms
