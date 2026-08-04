# Email via Gmail API (OAuth2) — Setup Runbook

Send all transactional email (OTP codes, password-reset codes) **as
`support@errandguyph.com`** through the **Gmail REST API**, authenticated with an
**OAuth2 user-refresh token**. Replies to `support@` land in the Gmail inbox
(receiving is just Workspace + MX — no app code).

## Why OAuth2 and not a service account

The original plan was a service account with domain-wide delegation. Our Google
org enforces **`iam.managed.disableServiceAccountKeyCreation`** ("Secure by
Default"), which blocks creating service-account keys, and no one on the team
holds `roles/orgpolicy.policyAdmin` to grant an exception. An **OAuth client** is
a *different credential type* that the policy does **not** block — so we send
with an OAuth2 refresh token minted by consenting as `support@errandguyph.com`.
No key, no delegation, no org-policy change. (The service-account path is kept as
an appendix in case the policy is ever lifted.)

The application code is already merged (custom `gmail` mail transport). This
runbook covers the parts outside the codebase: Google Cloud OAuth setup, DNS, and
the Forge production env.

---

## Overview — the moving parts

| Part | Where | Produces |
|---|---|---|
| 1. OAuth consent screen | Google Auth Platform (Internal) | consent config, no verification |
| 2. OAuth client (Web application) | GCP → Credentials | **Client ID + Client secret** |
| 3. `gmail.send` scope | Google Auth Platform → Data Access | scope grantable at consent |
| 4. Refresh token | OAuth 2.0 Playground | the **refresh token** (`1//…`) |
| 5. DNS (MX/SPF/DKIM/DMARC) | your DNS host | receiving + deliverability |
| 6. Forge env | Forge | production sends live |
| 7. Deploy + verify | git push + tinker | proof it sends as support@ |

---

## Step 1 — OAuth consent screen (Internal)

1. GCP → **APIs & Services → OAuth consent screen** (a.k.a. Google Auth Platform).
2. Enable the **Gmail API** if not already (APIs & Services → Library → "Gmail API" → Enable).
3. **Audience: Internal.** Only users in the `errandguyph.com` org can consent, and
   you **skip Google verification** even for the sensitive `gmail.send` scope.
   Internal apps also issue **non-expiring** refresh tokens (External/testing
   tokens die after 7 days).
4. Branding: app name `ErrandGuy`, user support email `support@errandguyph.com`. Save.

## Step 2 — OAuth client (Web application)

1. GCP → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   *(This is NOT a service-account key, so the org policy allows it.)*
2. **Application type: Web application.** (Not iOS/Android — the token is used by
   the Laravel **server**, not the phone apps. Customers/runners never touch Gmail;
   they only receive mail.)
3. Name: `ErrandGuy Mail Server`.
4. **Authorized redirect URIs → Add URI:**
   ```
   https://developers.google.com/oauthplayground
   ```
   (needed so the Playground can mint the token in step 4).
5. Create → copy the **Client ID** and **Client secret**.

## Step 3 — Add the `gmail.send` scope

Google Auth Platform → **Data Access → Add or remove scopes** → add:
```
https://www.googleapis.com/auth/gmail.send
```
Save.

## Step 4 — Mint the refresh token (OAuth Playground)

1. Open **https://developers.google.com/oauthplayground**.
2. **⚙️ gear** (top-right) → tick **"Use your own OAuth credentials"** → paste the
   Client ID + Client secret from step 2. Confirm **Access type: Offline** and
   **Force prompt: Consent Screen** (defaults; Offline is what returns a refresh token).
3. Left "Step 1" → **Input your own scopes** →
   `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs**.
4. **Sign in as `support@errandguyph.com`** (critical — Gmail sends as whoever
   consents) → Allow.
5. "Step 2" → **Exchange authorization code for tokens** → copy the
   **`refresh_token`** (`1//…`).

> No refresh token returned? Revoke the app at
> <https://myaccount.google.com/permissions> (as support@) and redo — first
> consent always returns one.

## Step 5 — DNS: receiving + deliverability

At whatever hosts `errandguyph.com`'s DNS. Without SPF/DKIM/DMARC your OTP mail
lands in spam.

- **MX** → Google (makes `support@` *receive*): `ASPMX.L.GOOGLE.COM` etc. — use the
  exact records from Admin Console → Domains.
- **SPF** (one TXT at root; merge if you already have one):
  `v=spf1 include:_spf.google.com ~all`
- **DKIM**: Admin Console → Apps → Google Workspace → Gmail → Authenticate email →
  generate the 2048-bit record → publish the TXT → Start authentication.
- **DMARC** (`_dmarc` TXT): `v=DMARC1; p=quarantine; rua=mailto:dmarc@errandguyph.com`

Verify: `dig +short MX errandguyph.com`, `dig +short TXT errandguyph.com`, etc.

## Step 6 — Forge production env

In **Forge → site → Environment** (writes to the shared `.env`, symlinked into the
app at `current/errandguy-api/.env`):

```dotenv
MAIL_MAILER=gmail
MAIL_FROM_ADDRESS="support@errandguyph.com"
MAIL_FROM_NAME="ErrandGuy"

GMAIL_OAUTH_CLIENT_ID="<client id from step 2>"
GMAIL_OAUTH_CLIENT_SECRET="<client secret from step 2>"
GMAIL_OAUTH_REFRESH_TOKEN="<the 1//… token from step 4>"
```
> `MAIL_FROM_ADDRESS` **must** equal the account that consented
> (`support@errandguyph.com`), or Gmail rejects the `From` header.
> `GMAIL_IMPERSONATE` is only used by the service-account fallback — omit here.

## Step 7 — Deploy + verify

1. Deploy the code (push to main → Forge auto-deploy runs `composer install`).
2. Rebuild config cache (deploy script, or manually):
   ```bash
   php artisan config:clear && php artisan config:cache
   ```
   *(Run artisan in the shell — NOT inside `php artisan tinker`.)*
3. Smoke-test (real recipient):
   ```bash
   php artisan tinker
   ```
   ```php
   Mail::raw('ErrandGuy test '.now(), fn($m) => $m->to('support@errandguyph.com')->subject('send test'));
   ```
   Success = mail arrives **and** appears in `support@errandguyph.com`'s **Sent**
   folder. Then test password-reset + email-OTP from the app.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Mailer [gmail] is not defined` | Code not deployed yet | Deploy; then `config:clear && config:cache`. |
| `Request to the Resend API failed` | Server still on `MAIL_MAILER=resend` | Set `MAIL_MAILER=gmail` in Forge env + `config:cache`. |
| `invalid_grant` | Refresh token revoked/expired, or wrong account | Re-run the Playground signed in as support@. |
| 400 with a `From` error | `MAIL_FROM_ADDRESS` ≠ the consenting account | Both must be `support@errandguyph.com`. |
| Sends but lands in spam | SPF/DKIM/DMARC not propagated | Recheck step 5; test at <https://www.mail-tester.com>. |

---

## Reference — what the code does

- **Transport:** `app/Mail/Transport/GmailApiTransport.php` — takes any google/auth
  credential, base64url-encodes the RFC822 message, POSTs to
  `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`. Access token
  cached ~55 min in the app cache.
- **Registration:** `AppServiceProvider::boot()` → `Mail::extend('gmail', …)`, whose
  `buildGmailCredentials()` builds OAuth2 `UserRefreshCredentials` when
  `GMAIL_OAUTH_REFRESH_TOKEN` is set, else a service-account credential.
- **Config:** `config/mail.php` → `mailers.gmail`.
- **Send sites:** `app/Services/OTPService.php::sendViaEmail()` and
  `app/Http/Controllers/Auth/PasswordResetController.php::forgotPassword()`.
- **Dependency:** uses `google/auth` (present via `kreait/firebase-php` in the lock).

## Notes & limits

- **Daily cap:** Gmail API ~2,000 messages/day per Workspace user — plenty for OTP +
  resets. For receipts/marketing/bulk, use a transactional provider (Resend is still
  installed), not Gmail.
- **Refresh token longevity:** Internal-app tokens don't expire from inactivity.
  They break only on revoke, deleting the OAuth client, or a support@ password
  change → re-run step 4.
- **SMS is unwired:** `OTPService::sendViaSMS()` throws by design. Phone OTP is the
  higher-volume channel when built — budget a real SMS provider then.
- **Latency:** sends are synchronous (~300 ms Gmail round-trip added to OTP/reset
  responses). Optional: move to the Redis queue to remove it.
- **Rollback:** set `MAIL_MAILER=resend` in Forge env + `config:cache`. Instant
  revert; no code change.

---

## Appendix — service-account alternative (if the org policy is ever lifted)

If someone with `roles/orgpolicy.policyAdmin` grants a project-scoped exception to
`iam.managed.disableServiceAccountKeyCreation`, you can switch to a service account
with domain-wide delegation instead of OAuth:

1. Create a service account → **Keys → Add key → JSON**.
2. Admin Console → Security → API controls → **Domain-wide delegation** → add the
   key's numeric **client_id** with scope `https://www.googleapis.com/auth/gmail.send`.
3. Set env (instead of the OAuth vars): the discrete fields `GMAIL_CLIENT_EMAIL`,
   `GMAIL_PRIVATE_KEY`, `GMAIL_PRIVATE_KEY_ID`, `GMAIL_PROJECT_ID`, `GMAIL_CLIENT_ID`,
   `GMAIL_CLIENT_CERT_URL` (or `GMAIL_SA_BASE64` / `GMAIL_SA_PATH`) **plus**
   `GMAIL_IMPERSONATE="support@errandguyph.com"`. `GMAIL_PRIVATE_KEY` accepts a PEM
   with `\n` escapes on one line; the resolver normalizes it.

The transport auto-selects the mode: OAuth if `GMAIL_OAUTH_REFRESH_TOKEN` is set,
otherwise the service account.
