# Chore: Update npm dependencies to latest versions

## Description

Update all npm dependencies to their latest compatible versions to address security vulnerabilities, improve performance, and access new features. This includes both production and development dependencies.

## Scope

**In scope:**

- All packages in `dependencies`
- All packages in `devDependencies`
- Updating lock file (package-lock.json)
- Fixing breaking changes from major version updates

**Out of scope:**

- Peer dependencies of other packages
- Node.js version upgrade
- npm version upgrade

## Tasks

1. **Audit current dependencies**
   - Run `npm audit` to identify security vulnerabilities
   - Run `npm outdated` to list available updates
   - Document packages with major version updates

2. **Update minor and patch versions**
   - Run `npm update` to update within semver ranges
   - Run tests to verify no regressions
   - Commit if tests pass

3. **Update major versions one at a time**
   - Update each major version bump individually
   - Review changelog for breaking changes
   - Update code to handle breaking changes
   - Run tests after each update
   - Commit after each successful update

4. **Verify build and tests**
   - Run full test suite
   - Run build process
   - Verify application starts correctly

5. **Clean up**
   - Remove unused dependencies if found
   - Update .nvmrc if Node.js version requirement changed
   - Verify lock file is committed

## Validation Criteria

- `npm audit` returns no high or critical vulnerabilities
- `npm outdated` shows all packages are up to date
- All tests pass
- Build completes successfully
- Application starts and functions correctly
