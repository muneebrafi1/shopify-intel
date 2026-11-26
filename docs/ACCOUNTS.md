# Accounts and Pro (Whop)

Sign-in, plans, boards and checkout. They run on Whop, and the code is in place. **Nothing is live
yet:** there is no Whop app, product, webhook or key anywhere. Without the variables below:

- sign-in says it isn't open yet
- the Pro buttons explain that
- `/api/whop/webhook` answers 503

## How it fits together

| Piece             | Where                                                                                 | Notes                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in with Whop | `/auth/whop/start` → Whop → `/auth/whop/callback`                                     | OAuth 2.1 + PKCE + OIDC, scopes `openid profile email`. The PKCE verifier and state are kept in a signed 10-minute cookie (`vt_oauth`, HMAC with `USER_SESSION_SECRET`). Tokens are used once to read userinfo, then thrown away.                                                        |
| Sessions          | `user_sessions` (migration 0004)                                                      | `vt_session` is an HttpOnly, SameSite=Lax cookie holding 32 random bytes. The DB stores only their SHA-256. Sessions last 30 days, with at most 10 per user. `vt_in=1` is a readable flag with no credential in it. The header uses it to show "Account" on CDN-cached pages.            |
| Plans             | `users.plan`, derived from `whop_memberships`                                         | Team if any Team membership grants access, else Pro if any Pro one does, else Free. Granting statuses: `active`, `trialing`, `canceling`, `past_due`. `lifetime` is kept as is (draft).                                                                                                  |
| Webhooks          | `POST /api/whop/webhook`                                                              | Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,…`), with a 5-minute window. Deliveries are deduped on `webhook-id`, and older events never overwrite newer ones. `membership.*` events are applied; everything else is acknowledged and ignored. |
| Boards            | `/account/boards`, `/account/save`, `/account/actions`, `/account/export/<board>.csv` | Pro and Team only. Every query is scoped by user id. They are plain form posts, so no JS is needed. Same-origin is checked in middleware.                                                                                                                                                |
| Checkout          | `/pro` buttons                                                                        | `WHOP_CHECKOUT_*` links for each plan and billing period. Without them the buttons fall back to the sign-in note. Members pay on Whop, then sign in with the same Whop account. The membership is matched by Whop user id, even when the webhook arrives before the first sign-in.       |
| Dev sign-in       | `POST /auth/dev`                                                                      | Needs `DEV_SIGN_IN=1` and `USER_SESSION_SECRET`, **and** a request to 127.0.0.1 or localhost. Everywhere else it returns 404. Used by the e2e tests and for local work.                                                                                                                  |

Middleware loads the user only on `/account/**`, `/auth/**` and `/sign-in`. Every public page stays
user-agnostic and cacheable. `/account/boards/example-*` stays public as a preview.

## Variables

Names only; see `.dev.vars.example`. Set production values as Worker secrets. **That needs the
owner's go-ahead.**

- `USER_SESSION_SECRET`: 32+ random characters (required for any sign-in)
- `WHOP_CLIENT_ID`, optional `WHOP_CLIENT_SECRET`: the Whop OAuth app
  - redirect URI: `<origin>/auth/whop/callback`
- `WHOP_ENVIRONMENT=sandbox`: use `sandbox-api.whop.com` while testing
- `WHOP_WEBHOOK_SECRET`: the `ws_…` secret of the webhook pointing at `<origin>/api/whop/webhook`
  - events: `membership.activated`, `membership.deactivated`, `membership.updated`,
    `membership.cancel_at_period_end_changed`
- `WHOP_PRO_PRODUCT_ID`, `WHOP_TEAM_PRODUCT_ID`: the `prod_…` ids that grant each plan
- `WHOP_CHECKOUT_PRO_MONTHLY`, `…_PRO_YEARLY`, `…_TEAM_MONTHLY`, `…_TEAM_YEARLY`: https checkout links
  - prices: Pro $12/mo or $120/yr, Team $39/mo or $390/yr (drafts)

## Trying it locally

```sh
# .dev.vars: USER_SESSION_SECRET=…, DEV_SIGN_IN=1, WHOP_WEBHOOK_SECRET=ws_local_…, WHOP_PRO_PRODUCT_ID=prod_LOCALPRO
npx wrangler d1 migrations apply DB --local   # or npm run setup (wipes local data)
npm run dev                                    # /sign-in shows "Dev sign-in"
node scripts/whop/send-fixture.ts membership-activated --user user_dev… --product prod_LOCALPRO
```

`send-fixture.ts` signs a fixture from `tests/unit/fixtures/whop/` with the local secret. It refuses
any URL that isn't local.

## To verify against the Whop sandbox before launch

1. **Webhook key bytes.** We sign with the UTF-8 bytes of the whole `ws_…` string; Whop's SDK passes
   `btoa(secret)` to the standardwebhooks library, which decodes back to those bytes. The HMAC
   itself matches the Standard Webhooks reference vector (unit test). Confirm with one real sandbox
   delivery.
2. **Event shape.** The current API sends a flat `user_id` / `product_id` / `variant_id` /
   `current_period_end`. Older pins send nested `user`, `product` and `plan` objects. Both are read.
3. **Userinfo email.** Whop may withhold the email. The user then gets the placeholder
   `<user_id>@users.whop.invalid`, and the account page says "Not shared by Whop".

## Not done (open questions)

- **Team seats.** Team grants 3 seats on paper, but there are no invites yet. Who joins how, through
  Whop seats or our own invites? Shared boards depend on it.
- **Pro gating of content.** Free covers home-page screenshots plus basic data. Pro covers every page
  type, full-page and section screenshots, and exports. The store viewer does not hide other page
  types from Free visitors yet, because captures are still a preview. The gate needs a decision on
  what Free visitors see in place of the hidden content, plus server-side checks on media URLs.
- **Lifetime deal** ($79, first 100): still a draft, with no product wired.
- **Theme-switch alerts.** These need a mail provider.
- **Email sign-in** (magic link) was dropped in favour of Whop-only sign-in. It also needs a mail
  provider.
