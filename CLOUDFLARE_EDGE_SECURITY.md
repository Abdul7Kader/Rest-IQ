# RestIQ Cloudflare Edge Security Plan

Status: preparation only. No live Cloudflare rules were changed by this file.

This matrix is based on the current Express routes in `server.js`. It separates
edge-level abuse controls from the existing app controls:

- App controls remain mandatory: auth, roles, CSRF, input validation, upload
  validation, and in-process rate limits.
- Cloudflare controls should reduce obvious bot/DoS traffic before it reaches
  the app.
- Thresholds below are starting points for manual configuration and must be
  tuned with real traffic logs before production rollout.

## Current App Controls

| Area | Current app control |
| --- | --- |
| Login/Register | `authRateLimit`, centralized JSON validation |
| Mutating routes | CSRF protection except login/register |
| Upload | owner role, CSRF, expensive action rate limit, magic-byte image checks |
| CF prepare/export | owner/admin role, CSRF, expensive action rate limit |
| Admin APIs | admin role and CSRF for mutations |

## Edge Rule Matrix

| Group | Target paths | Edge action | Suggested starting threshold | Reason |
| --- | --- | --- | --- | --- |
| Public static and marketing pages | `/`, `/index.html`, `/register.html`, `/css/*`, `/js/*`, `/templates/*` | Cache where safe; no strict rate limit | Do not rate-limit normal browsing | These pages should stay easy to load and are mostly static. |
| Public help/provider APIs | `/api/help/articles*`, `/api/public/domain-providers` | Light rate limit | 120 requests / 5 minutes / IP | Public JSON endpoints are read-only but can be scraped. |
| Auth | `/api/auth/login`, `/api/auth/register` | Rate limit and bot challenge if abused | 10 requests / 5 minutes / IP, tighter on repeated failures if available | Credential stuffing and fake registrations are the main risk. |
| Session helper | `/api/auth/me`, `/api/auth/csrf` | Light rate limit | 120 requests / 5 minutes / IP | Needed by the app, but repeated calls are not useful at high volume. |
| Owner read APIs | `/api/restaurant`, `/api/restaurant/status`, `/api/restaurant/onboarding`, `/api/menu`, `/api/opening-hours`, `/api/special-closures`, `/api/media-assets`, `/api/preview` | Moderate authenticated API limit | 300 requests / 5 minutes / IP | Authenticated dashboard use needs room, but loops should be slowed. |
| Owner mutations | `/api/restaurant`, `/api/restaurant/setup`, `/api/restaurant/domain`, `/api/opening-hours`, `/api/special-closures*`, `/api/menu/categories*`, `/api/dishes*`, `/api/media-assets*` | Lower write limit | 90 requests / 5 minutes / IP | Writes hit DB and should not be spammed. App CSRF still applies. |
| Upload | `/api/uploads/image` | Strict upload limit and request size cap at edge if configured | 20 requests / 15 minutes / IP | Uploads consume CPU, disk/R2, and bandwidth. App limit remains active. |
| Publish/export prepare | `/api/restaurant/cf-prepare`, `/api/admin/cf-prepare/*` | Strict action limit | 10 requests / 30 minutes / IP | Static export is expensive and already has app-level rate limiting. |
| Admin read APIs | `/api/admin/summary`, `/api/admin/platform-settings`, `/api/admin/domain-providers`, `/api/admin/ad-slots`, `/api/admin/restaurants*` | Moderate authenticated API limit | 180 requests / 5 minutes / IP | Admin traffic is low volume; spikes should be visible. |
| Admin mutations | `/api/admin/platform-settings`, `/api/admin/domain-providers*`, `/api/admin/ad-slots*`, `/api/admin/restaurants/*`, `/api/admin/domains/*` | Lower write limit and alert | 60 requests / 5 minutes / IP | Admin writes change platform-wide state. App role and CSRF remain mandatory. |

## Path Notes

- `POST /api/auth/login` and `POST /api/auth/register` are CSRF-exempt in the
  app because they create the session, so they should get extra edge attention.
- `/api/uploads/image`, `/api/restaurant/cf-prepare`, and
  `/api/admin/cf-prepare/:restaurantId` already have app-level expensive action
  limits. Edge rules should complement them, not replace them.
- Published restaurant assets may later be served through R2 or Pages. Do not
  apply the strict API write limits to static public restaurant pages or image
  URLs.

## Manual Cloudflare Rollout Checklist

1. Create the rules in a staging zone or non-critical Pages project first.
2. Start with log/challenge modes where available instead of immediate blocking.
3. Compare Cloudflare events with app logs for false positives.
4. Tighten only the high-risk groups first: Auth, Upload, Publish/export prepare.
5. Keep app-side auth, CSRF, validation, and rate limits enabled even after edge
   rules exist.
