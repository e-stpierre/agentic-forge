# Bug Fix: Login fails on Safari when using OAuth

## Description

Users on Safari browser cannot complete OAuth login flow. After authenticating with the OAuth provider (Google, GitHub), they are redirected to a blank page instead of the dashboard. This affects approximately 15% of users and has been reported multiple times.

## Reproduction Steps

1. Open application in Safari browser (version 17+)
2. Click "Login with Google" button
3. Complete Google authentication flow
4. Observe blank page instead of dashboard redirect

Expected: User should be redirected to `/dashboard` after successful OAuth authentication

## Root Cause Analysis

The OAuth callback handler relies on `window.opener` to communicate with the parent window. Safari's Intelligent Tracking Prevention (ITP) blocks cross-origin communication in this context, causing the callback to fail silently.

Relevant code location: `src/auth/oauth-callback.ts:45-67`

The current implementation:
```typescript
// This fails in Safari due to ITP
window.opener.postMessage({ token }, window.location.origin);
window.close();
```

## Fix Strategy

Replace the `window.opener.postMessage` approach with a cookie-based token transfer that works across all browsers:

1. Store the OAuth token in an HTTP-only cookie on callback
2. Redirect the callback window to the dashboard
3. Dashboard reads token from cookie and establishes session
4. Clear the cookie after session is established

## Tasks

1. **Modify OAuth callback handler**
   - Remove `window.opener.postMessage` approach
   - Set HTTP-only cookie with OAuth token
   - Redirect to dashboard instead of closing window

2. **Update dashboard authentication**
   - Check for OAuth token cookie on load
   - Establish session from cookie if present
   - Clear cookie after session established

3. **Add Safari-specific handling**
   - Detect Safari browser in login flow
   - Use redirect-based OAuth flow instead of popup for Safari
   - Maintain popup flow for other browsers for better UX

4. **Update tests**
   - Add Safari browser mock tests
   - Test cookie-based token transfer
   - Test redirect flow end-to-end

## Validation

- OAuth login works in Safari 17+
- OAuth login continues to work in Chrome, Firefox, Edge
- No security regressions (token not exposed in URL)
- Session persists after page refresh
- Logout works correctly

## Testing

- Add unit tests for cookie-based token handling
- Add integration test for Safari redirect flow
- Add E2E test with Safari WebDriver
- Manual testing on Safari 17, 16, and Safari on iOS
