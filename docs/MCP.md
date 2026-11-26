# MCP Server (`/mcp`)

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server over Streamable HTTP
(stateless JSON-RPC 2.0 on `POST /mcp`), built directly on API v1 (`src/server/api/v1/registry.ts`).

## What it exposes

- **Tools (`src/server/mcp/tools.ts`)**: every public `GET` endpoint in `endpointList` except
  `index` (22 read-only tools: `getMeta`, `search`, `listStores`, `getStore`, `listThemes`,
  `getTheme`, `listThemeStores`, `listApps`, `listAppCategories`, `getApp`, `listAppStores`,
  `listSections`, `listSectionsByApps`, `listSectionTypes`, `getSection`, `getScreenshot`,
  `listTeardowns`, `getTeardown`, `getComparison`, `listComparisons`, `getAlternatives`,
  `listAlternatives`).
- **Write endpoints excluded**: `POST /api/v1/removal-requests` (`createRemovalRequest`) and every
  `/api/v1/admin/*` route are never exposed.
- **Tool annotations**: every tool sets `readOnlyHint: true`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: false`.
- **Schemas & execution**: `inputSchema` is generated from each endpoint's Zod schema via
  `z.toJSONSchema(..., { io: 'input' })`. Calls run through `execute()`, so validation, provenance
  (`meta.sources`, `meta.data_as_of`), `meta.canonical`, and pagination behave identically to `/api/v1`.
  Validation and not-found errors return `isError: true` in the tool result so the assistant can
  self-correct.

## Protocol & HTTP

- **Endpoint**: `POST /mcp` (`Content-Type: application/json`, max 32 KB body).
- **Protocol versions**: `2025-11-25`, `2025-06-18`, `2025-03-26` (default fallback), `2024-11-05`.
- **Methods**: `initialize`, `ping`, `tools/list`, `tools/call`, plus notifications (`202 Accepted`).
- **Unsupported HTTP methods**: `GET /mcp` returns `405` (`Allow: POST, OPTIONS`), matching the
  stateless Streamable HTTP spec when no SSE stream is offered. `OPTIONS` returns `204` with CORS
  headers (`Access-Control-Allow-Origin: *`).

## Rate limiting

- **Limit**: 60 requests per 60 seconds per hashed client IP (`IP_HASH_SALT`, table
  `mcp_rate_limits` from `migrations/0005_mcp_rate_limit.sql`). Raw IPs are never stored.
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Exceeding the
  limit returns HTTP `429` with `Retry-After` and JSON-RPC error `-32029`.
- **D1 budget**: 1 query per request on the hot path (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`),
  pruning expired buckets via `waitUntil` when a new IP-window row starts. Even with the heaviest
  tool (`getTeardown`, 20 queries), total D1 queries per request stay well below the 50-query limit.

## Client configuration

```json
{
  "mcpServers": {
    "vitrine": {
      "url": "https://<origin>/mcp"
    }
  }
}
```
