# AGENTS.md — rules for AI coding agents (same as CLAUDE.md)

Read this file, `docs/BRIEF.md` and `docs/ARCHITECTURE.md` before writing code.

## Git workflow
- **Never push to `main`.** Never force-push to `main`. (This is a free private repo, so branch
  protection cannot enforce this — it is on you.)
- Work on a feature branch (`feat/<area>`, `fix/<thing>`), open a pull request into `main` (or
  stack PRs on each other's branches), and let the owner review and merge.
- Prefer a **stack of small, reviewable PRs** over one giant PR. Each PR description says what
  changed, why, and includes **desktop and mobile screenshots** of every page it touches
  (before/after when it changes existing UI).
- CI must be green before you ask for review.
- **Never run two sessions on the same branch.** One session owns one branch at a time.

## Secrets and security
- No secrets, API keys, tokens, account IDs or personal emails in code, commits, PRs or logs.
  Use environment variables / Wrangler secrets and document the variable names in
  `.env.example` (names only, no values).
- Nothing secret is ever shipped to the browser. Admin routes are protected server-side.
- Do not deploy. Do not create Cloudflare resources or DNS records. Deploy-ready config is fine;
  the owner deploys.
- Affiliate links are public referral URLs (not secrets) and live in data, never inline in
  components.

## Quality
- When a test fails because of layout, **fix the layout — do not loosen or delete the test.**
  CI machines can differ from yours (fonts, viewport); make the UI robust instead.
- Check every page at mobile (390px) and desktop (1440px) widths with real screenshots.
- The brand name comes from the single `SITE_NAME` constant. Don't hard-code it.
- Design must never look AI-generated: see "Design principles" in `docs/BRIEF.md`.

## Stopping / usage limits
- Before you stop for any reason (usage limit, end of task, blocked), push everything and write
  or update **`docs/HANDOFF.md`**: what is done, what is in progress (branch + PR numbers), what
  is next, open questions, and any gotchas. A new session will start by reading it.

## Questions
- Don't stall on small decisions — make a sensible choice, note it, and keep going.
- **List your open questions for the owner at the end** of your final message (and in
  `docs/HANDOFF.md`).
