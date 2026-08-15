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
- Participation certificate: `certificado.html` + `assets/js/certificate.js` + `assets/css/certificate.css`
- Public ranking: `ranking.html` + `assets/js/ranking.js`
- Shared navigation: `_includes/nav.html` (carries the "Minha conta" link on every page)
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

`duration_minutes` (migration `0015`, default 240) and `xp_reward` (migration `0016`,
default 100) are per-meetup knobs. Duration is printed on the certificate and defines
when the meetup *ended*; XP is what a participation is worth in the ranking. Adjust with
`UPDATE meetups SET duration_minutes = ?, xp_reward = ? WHERE slug = ?`.

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

### `certificates`

One row per issued certificate (migration `0015`).

- `id` (PK)
- `code` (UNIQUE, public identifier — `HIB-XXXX-XXXX-XXXX`)
- `meetup_slug` (FK)
- `registration_id` (FK, UNIQUE together with `meetup_slug`)
- `participant_name`, `duration_minutes` — snapshots taken at issue time
- `issued_at`

The name and duration are copied instead of joined on purpose: reprinting a certificate
months later must not hand back a document that differs from the one already in the
person's hands.

### `participant_profiles`

Opt-in profile for the public ranking (migration `0016`).

- `id` (PK)
- `email` (UNIQUE — links the profile to registrations; never leaves the Worker)
- `nickname`
- `nickname_key` (UNIQUE, lowercase and unaccented — two nicknames differing only in
  case or accent are the same nickname to a reader, and allowing both invites impersonation)
- `is_public`
- `created_at`, `updated_at`

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

Returns `email`, `confirmationWord`, the `profile` (ranking nickname, `isPublic`, total
`xp`, `meetupsAttended`) and the registrations tied to that address: `meetupSlug`,
`title`, `eventDate`, `durationMinutes`, `name`, `registeredAt`, `isPast`, `canCancel`,
`xpReward`, `xpEarned` and `certificate` (`available`, `availableAt`, `code`, `url`).

Bundling the profile here avoids a second round-trip: the page renders the list and the
ranking card from one response.

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

### `POST /api/me/registrations/:slug/certificate`

Requires `Authorization: Bearer <session token>`. Issues (or re-returns) the
participation certificate.

- `404` when the session's e-mail has no registration for that meetup.
- `409` while the certificate is not available yet, with `availableAt` in the body.
  Availability is `event_date + duration_minutes + 24h`: a presence document should not
  exist while the meetup is still wrapping up.
- `200` with `certificate`: `code`, `participantName`, `meetupSlug`, `meetupTitle`,
  `eventDate`, `durationMinutes`, `issuedAt`, `url`.

Issuing twice returns the **same** code. The insert uses
`ON CONFLICT (meetup_slug, registration_id) DO NOTHING` followed by a re-read, so two
simultaneous clicks converge on one certificate instead of racing to create two.

### `GET /api/certificates/:code`

Public, no session. This is how a company or university checks a certificate it received.

- Codes are 12 characters drawn from a 32-symbol alphabet without `I`, `O`, `0` and `1`
  (~60 bits), so they cannot be guessed; lookup is case-insensitive.
- Returns the same `certificate` payload as above — never e-mail, CPF or phone.
- `404` for unknown or malformed codes.

### `POST /api/me/profile`

Requires `Authorization: Bearer <session token>`. Request JSON: `nickname`, `isPublic`.

- Nickname: 3–24 characters, starts and ends with a letter or digit, allows space, `.`,
  `-` and `_` in between. No emoji, no control characters, no RTL overrides.
- Names that would pass someone off as the organisation (`hackinbrasil`, `organizador`,
  `admin`, `staff`, ...) are rejected with `400`.
- A nickname already taken by someone else returns `409`.
- `200` returns the updated `profile`.

### `GET /api/ranking`

Public, no session. Returns at most 100 rows of `{position, nickname, xp}` — nothing else.

XP is computed, never stored: `SUM(xp_reward)` over the registrations of public profiles
whose meetup has already ended
(`datetime(event_date, '+' || duration_minutes || ' minutes') <= datetime('now')`).
Being signed up for an upcoming meetup is not participation, so it does not score.

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
- The certificate code is the only key to the public lookup, and it is unguessable
  (~60 bits). Whoever holds a certificate can already read the name printed on it, so the
  endpoint discloses nothing the document does not
- The ranking is opt-in and shows nickname + XP only. That is the whole point of the
  nickname: `participant_profiles.email` is the join key and never leaves the Worker
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

## Participation certificate

- Issued from `/minhas-inscricoes/`: past meetups show **Gerar certificado** once the
  24h window has elapsed, and **Ver certificado** (a plain link) after that. The tab is
  opened synchronously on click, before the POST, so pop-up blockers do not swallow it.
- `/certificado/?codigo=HIB-...` renders the document and doubles as the public
  verification page: with no code it shows a lookup form.
- The certificate is HTML/CSS, printed to PDF by the browser (**Baixar em PDF** →
  *Salvar como PDF*, landscape). There is no PDF generator in the Worker.
- Layout is A4 landscape with a fixed aspect ratio, typed in container units (`cqw`), so
  screen and paper are the same document at different scales. `@page { size: A4 landscape }`
  and the print rules live in `assets/css/certificate.css`, loaded only on that page via
  the `extra_css` front-matter hook — in `style.css` they would change how every other
  page prints.
- Signatures use Allura (self-hosted, OFL) over the co-organiser names; the seal is
  `assets/images/hackinbrasil-seal.png`, a copy of the logo with the baked-in black
  background keyed out (the original would be a black square on the light band).

## Public ranking

- `/ranking/` lists position, nickname and XP. Nothing identifies the person.
- Participants opt in from `/minhas-inscricoes/`: pick a nickname, tick "Quero aparecer
  no ranking público", save. Unticking it removes them from the list immediately.
- XP is summed from `meetups.xp_reward` for meetups that already ended, so the ranking
  cannot be gamed by registering for future events.

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
