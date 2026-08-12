# Meetup Subscriptions - Architecture and Operations

This project keeps a static Jekyll frontend and uses Cloudflare Workers + D1 for meetup registrations.

## Scope

- Static site stays on GitHub Pages.
- Registrations are handled by Cloudflare Worker API.
- Hard capacity limit is enforced server-side.
- No waitlist.
- Confirmation emails are sent via Resend after a 10-minute delay.

## Components

- Frontend form: `meetup-25-03-2026.html`
- Frontend client logic: `assets/js/meetup-registration.js`
- Self-service area: `minhas-inscricoes.html` + `assets/js/meetup-subscriptions.js`
- Worker API: `workers/meetup-api/src/index.js`
- D1 schema/migrations: `workers/meetup-api/migrations/0001_schema.sql`
- Worker deploy workflow: `.github/workflows/deploy-worker.yml`

## Data model

### `meetups`

- `slug` (PK)
- `title`
- `event_date`
- `capacity`
- `registrations_count`
- `is_open`
- `created_at`, `updated_at`

### `registrations`

- `id` (PK)
- `meetup_slug` (FK)
- `name`
- `email`
- `phone_encrypted` (E.164, e.g. `+5511912345678`, AES-GCM encrypted like the CPF; column added in `0005`, encrypted in `0007`)
- `document_encrypted`
- `document_last4`
- `consent_lgpd`
- `created_at`

### `email_templates`

- `id` (PK)
- `meetup_slug` (UNIQUE, FK)
- `subject`
- `text_body`
- `html_body`
- `created_at`, `updated_at`

### `email_jobs`

- `id` (PK)
- `meetup_slug` (FK)
- `template_id` (FK)
- `registration_id` (UNIQUE, FK)
- `recipient_name`
- `recipient_email`
- `subject`
- `text_body`
- `html_body`
- `send_after`
- `status` (`pending`, `processing`, `sent`, `failed`)
- `attempts`
- `last_error`
- `resend_email_id`
- `sent_at`
- `created_at`, `updated_at`

### `auth_login_requests`

One row per magic link request (migration `0014`).

- `id` (PK)
- `email_hash` (HMAC blind index, always filled — used for rate limiting without leaking whether the address exists)
- `email` (only when a token was issued)
- `token_hash` (UNIQUE, SHA-256 of the magic link token; only when a token was issued)
- `expires_at`
- `consumed`
- `created_at`

### `auth_sessions`

- `id` (PK)
- `email`
- `token_hash` (UNIQUE, SHA-256 of the bearer token)
- `expires_at`
- `revoked`
- `created_at`

Migration `0014` also adds `idx_registrations_email`. Login and the listing both
filter registrations by e-mail alone, which the existing `UNIQUE (meetup_slug, email)`
index cannot serve (wrong leading column).

### `registration_cancellations`

Anonymous audit trail (no personal data) used to inspect capacity churn.

- `id` (PK)
- `meetup_slug`
- `cancelled_at`

## API

### `GET /api/meetups/:slug/status`

Returns availability status only:

- `slug`
- `title`
- `eventDate`
- `isOpen`
- `isFull`

### `POST /api/meetups/:slug/register`

Request JSON:

- `name`
- `email`
- `phone` (Brazilian mobile; `+55` is added server-side)
- `document` (CPF only)
- `consentLgpd` (must be `true`)

Validation:

- Name and email format
- Phone: Brazilian mobile — DDD (2 digits) + `9` + 8 digits
- CPF structure + check digits
- LGPD consent required

Responses:

- `201` success
- `409` when full or duplicate email
- `400` validation errors

Side effect:

- Tries to create an email job scheduled to send after 10 minutes.
- Registration remains successful even if email scheduling is temporarily unavailable.

## Subscription management (passwordless)

Participants manage their own registrations at `/minhas-inscricoes/`. There are no
passwords: access is granted by a single-use magic link sent by e-mail.

### `POST /api/auth/magic-link`

Request JSON: `email`, `captchaId`, `captcha`.

Behavior:

- Always answers `200` with the same generic message, so the endpoint cannot be used
  to discover which addresses have registrations.
- Every attempt is recorded by `email_hash`; more than 3 attempts in 15 minutes
  returns `429` (the counter is independent of whether registrations exist).
- A token is only generated and e-mailed when the address has registrations.
- Token: 32 random bytes, base64url. Only its SHA-256 hash is stored.
- Link format: `<SITE_BASE_URL>/minhas-inscricoes/?token=<token>`, valid for 15 minutes, single use.
- The e-mail is sent immediately through Resend (it does not go through `email_jobs`).
- The send is handed to `ctx.waitUntil` and **never awaited**. Waiting on a provider
  round-trip only in the branch where the address exists would leak that fact through
  response timing, which is exactly what the generic message exists to prevent.

The token is consumed by a `POST` from the page, not by loading the URL, so link
scanners and prefetchers that merely fetch the address do not burn it.

### `POST /api/auth/session`

Request JSON: `token` (from the magic link).

- Consumes the magic link atomically (guarded update on `consumed = 0`).
- Returns a bearer session token valid for 30 minutes.
- Responses: `200` with `token`/`email`, or `401` when the link is invalid, expired or already used.

The frontend stores the session token in `sessionStorage` and removes `?token=` from the
address bar with `history.replaceState` as soon as the page loads.

### `GET /api/me/registrations`

Requires `Authorization: Bearer <session token>`.

Returns `email`, `confirmationWord` and the registrations tied to that address:
`meetupSlug`, `title`, `eventDate`, `name`, `registeredAt`, `isPast`, `canCancel`.

Ordering is by usefulness, not raw date: upcoming meetups first with the nearest on
top, then past editions most recent first.

### `POST /api/me/registrations/:slug/cancel`

Requires `Authorization: Bearer <session token>`.

Request JSON: `confirmation` — the user must type `CANCELAR`. The value is normalized
(trim, uppercase, accents stripped) and validated **server-side**, not only in the UI.

Flow:

1. Confirm the registration belongs to the session's e-mail (`404` if not).
2. Reject with `409` when the meetup already happened.
3. In a single `batch()` (one transaction): remove pending/processing `email_jobs`,
   delete the registration, **recompute** `registrations_count` from the registrations
   table, and write the anonymous audit row.
4. Send a cancellation notice by e-mail (best effort).

The seat count is recomputed (`SET registrations_count = (SELECT COUNT(*) ...)`) instead
of decremented. That makes the operation idempotent — a double submit cannot give two
seats back — and it repairs any drift the counter already carries.

> Do not gate this flow on `meta.changes`. D1 counts rows removed by foreign-key cascades
> there as well: deleting a registration that still has an `email_jobs` row reports
> `changes: 2`, not `1`. An earlier version checked `changes !== 1` and ended up deleting
> the registration while reporting `404` and leaking the seat.

Responses: `200` success, `400` wrong confirmation word, `404` no registration,
`409` meetup already happened, `401` invalid session.

### `POST /api/auth/logout`

Requires `Authorization: Bearer <session token>`. Revokes the session.

### Cleanup

The `*/2 * * * *` cron also drops login requests and sessions older than one day.

## Capacity enforcement (no waitlist)

Server-side flow:

1. Atomically reserve 1 seat with guarded update (`registrations_count < capacity`)
2. Insert registration row
3. If insert fails, rollback reservation with decrement

This ensures frontend cannot bypass the limit.

## LGPD / Security

- CPF is encrypted with AES-GCM before storage (`DOC_ENCRYPTION_KEY_BASE64` secret)
- Consent flag is mandatory
- CORS restricted via `ALLOWED_ORIGIN`
- Passwordless login: single-use magic links (15 min), bearer sessions (30 min), only token
  hashes stored, generic responses to avoid account enumeration, CAPTCHA + rate limit on login
- Cancellation deletes the registration row (including the encrypted CPF and phone), keeping
  only an anonymous audit row — this doubles as the LGPD self-service deletion path
- All API responses carry `Cache-Control: no-store` and `Vary: Origin`, so personal data is
  never retained by a browser or intermediary and CORS answers are not shared across origins
- `/minhas-inscricoes/` sets `<meta name="referrer" content="no-referrer">` (via the
  `referrer_policy` front-matter hook in `_layouts/default.html`) so the `?token=` in the URL
  cannot reach a third party through the `Referer` header, and is kept out of the sitemap
- `docs/` is excluded from the Jekyll build. It used to be published at `/docs/`, exposing
  this operational detail (rate limits, TTLs, schema) at a public, indexable URL
- Recommendation: add Turnstile CAPTCHA and retention policy (delete records after event window)
- DPO contact for privacy requests: `dpo@hackinbrasil.com.br`

## Cloudflare setup checklist

1. Create D1 database `meetup_db`
2. Set D1 binding `DB` on Worker
3. Configure in `wrangler.toml`:
   - `database_id`
   - `ALLOWED_ORIGIN` (supports comma-separated origins)
   - `SITE_BASE_URL` (base of the magic link; falls back to the first `ALLOWED_ORIGIN`)
4. Apply migrations:

```bash
cd workers/meetup-api
npm install
npx wrangler d1 migrations apply meetup_db --remote
```

5. Set encryption secret:

```bash
openssl rand -base64 32
npx wrangler secret put DOC_ENCRYPTION_KEY_BASE64
```

6. Deploy:

```bash
npx wrangler deploy
```

7. Configure Resend:

```bash
npx wrangler secret put RESEND_API_KEY
```

`wrangler.toml` vars used by sender:

- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO` (optional)

8. Cron trigger:

- `*/2 * * * *` processes pending `email_jobs`.
- The sender uses a fixed limit of 100 sends per day.
- Failed jobs are retried after 10 minutes, up to 5 attempts.

## Frontend integration

Form attributes in `meetup-25-03-2026.html`:

- `data-api-base="https://<worker-domain>"`
- `data-meetup-slug="meetup-25-03-2026"`

UX behavior:

- Shows only "Inscrições abertas" or "Inscrições encerradas"
- No spot counts displayed
- Success/error shown in modal with close button

The self-service page (`minhas-inscricoes.html`) carries the same `data-api-base`
attribute on `#subscriptions-page`. Cancelling requires typing `CANCELAR` in the modal;
the button stays disabled until the typed text matches, and the Worker validates it again.

## Email template management

- The email content is stored in `email_templates`.
- You can update future meetup messages directly in D1 by editing `subject`, `text_body`, and `html_body`.
- Existing subscriptions were backfilled into `email_jobs` by migration `0002`.

## Troubleshooting

### Button remains disabled

- Check Worker status endpoint in browser/curl
- Verify `ALLOWED_ORIGIN` matches deployed site origin (`www` and non-`www` if needed)
- Hard refresh frontend cache

### `500` from Worker

- Usually missing D1 migrations or missing secret
- Re-apply migrations and verify `DOC_ENCRYPTION_KEY_BASE64`

### CORS issues

- Ensure origin is in `ALLOWED_ORIGIN`
- Redeploy Worker after changing `wrangler.toml`
