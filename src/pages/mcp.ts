/**
 * /mcp — stateless read-only MCP server (Streamable HTTP / JSON-RPC 2.0) over public API v1.
 * All protocol handling, tool dispatch, rate limiting and CORS live in src/server/mcp/server.ts.
 */
import type { APIRoute } from 'astro';
import { workerDeps } from '~/server/api';
import { createMcpHandler } from '~/server/mcp/server';

export const prerender = false;

let handler: ((request: Request) => Promise<Response>) | null = null;

export const ALL: APIRoute = ({ request }) => {
  handler ??= createMcpHandler(workerDeps());
  return handler(request);
};
