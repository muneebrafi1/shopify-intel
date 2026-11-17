# shopify-intel (working name)

A visual intelligence site for the Shopify ecosystem — "Mobbin for Shopify".
See real stores page by page, the theme and apps behind them, and how every theme and app
actually looks in the wild before you buy it.

> The brand is not decided yet. The product name lives in **one** config constant
> (`SITE_NAME`, plus `SITE_DOMAIN`). Never hard-code the name anywhere else.

- Product brief: [docs/BRIEF.md](docs/BRIEF.md)
- Proposed architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Rules for AI agents: [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)
- Seed data: [data/seed/](data/seed/README.md)

- Visual direction: [docs/design/direction.md](docs/design/direction.md) · design system:
  [docs/DESIGN.md](docs/DESIGN.md) · API: [docs/API.md](docs/API.md) · handoff:
  [docs/HANDOFF.md](docs/HANDOFF.md)

## Quick start

```bash
npm install
npm run setup   # seed the local D1 from data/seed (no cloud resources)
npm run dev     # http://localhost:4321
```

Astro 7 server-rendered on Cloudflare Workers, with D1 (data) and R2 (screenshots). The site and
the public JSON API (`/api/v1`) share one typed API layer that a future MCP server will wrap.
Checks: `npm run lint`, `npm run check`, `npm test`, `npm run build && npm run size`,
`npm run test:e2e`.

Status: base build. Nothing is deployed yet.
