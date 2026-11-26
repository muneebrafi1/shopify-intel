/**
 * Stateless MCP (Model Context Protocol) server over Streamable HTTP (JSON-RPC 2.0 on POST /mcp).
 * Exposes read-only tools backed by API v1 `execute()`, with D1-backed per-IP rate limiting and
 * CORS headers so assistants and inspectors can call it directly without an API key.
 */
import { SITE_NAME, SITE_URL } from '../../config/site.ts';
import { isApiError } from '../api/v1/errors.ts';
import { createRuntime, execute, type ApiDeps, type Runtime } from '../api/v1/execute.ts';
import { parseJsonObject } from '../auth/crypto.ts';
import { checkMcpRateLimit, rateLimitHeaders, type McpRateLimitOptions } from './rate-limit.ts';
import { mcpToolMap, mcpTools } from './tools.ts';

export const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
export const DEFAULT_PROTOCOL_VERSION = '2025-03-26';
export const MAX_MCP_BODY_BYTES = 32 * 1024;
export const MAX_BATCH_SIZE = 10;

export const MCP_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers':
    'Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
  'Access-Control-Max-Age': '86400',
};

type JsonRpcId = string | number;

interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

type JsonRpcResponse = JsonRpcError | JsonRpcSuccess;

const rpcError = (
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const rpcOk = (id: JsonRpcId, result: unknown): JsonRpcSuccess => ({
  jsonrpc: '2.0',
  id,
  result,
});

const clientIp = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? null;

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      'Cache-Control': 'no-store',
      ...MCP_CORS,
      ...extraHeaders,
    },
  });
}

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

export interface McpHandlerOptions {
  rateLimit?: Pick<McpRateLimitOptions, 'maxRequests' | 'windowSeconds'>;
}

export function createMcpHandler(
  deps: ApiDeps,
  opts: McpHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const rt: Runtime = createRuntime(deps);

  async function handleMessage(msg: unknown, ip: string | null): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return rpcError(null, -32600, 'Invalid Request');
    }
    const rec = msg as Record<string, unknown>;
    const rawId = rec.id;
    const hasId = 'id' in rec;
    const validId =
      typeof rawId === 'string' || (typeof rawId === 'number' && Number.isFinite(rawId));

    if (rec.jsonrpc !== '2.0' || typeof rec.method !== 'string' || !rec.method) {
      return rpcError(validId ? rawId : null, -32600, 'Invalid Request');
    }
    if (hasId && !validId) {
      return rpcError(null, -32600, 'Invalid Request: id must be a string or number');
    }
    // Notifications have no id and expect no JSON-RPC response.
    if (!hasId) return null;
    const id = rawId as JsonRpcId;
    const method = rec.method;
    const params =
      rec.params === undefined
        ? {}
        : rec.params && typeof rec.params === 'object' && !Array.isArray(rec.params)
          ? (rec.params as Record<string, unknown>)
          : null;
    if (params === null) return rpcError(id, -32602, 'Invalid params: expected an object');

    switch (method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
          ? requested
          : DEFAULT_PROTOCOL_VERSION;
        return rpcOk(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: SITE_NAME,
            title: `${SITE_NAME} MCP`,
            version: '1.0.0',
          },
          instructions: `Read-only access to ${SITE_NAME}'s public Shopify ecosystem data (${SITE_URL}). Use search first to find store domains, theme slugs, or app slugs, then inspect details or sections. Include meta.canonical links and meta.sources when citing results.`,
        });
      }
      case 'ping':
        return rpcOk(id, {});
      case 'tools/list':
        return rpcOk(id, { tools: mcpTools });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string' || !name) {
          return rpcError(id, -32602, 'Invalid params: tool name is required');
        }
        const def = mcpToolMap.get(name);
        if (!def) {
          return rpcError(id, -32602, `Unknown tool: ${name}`);
        }
        const args = params.arguments === undefined ? {} : params.arguments;
        if (args === null || typeof args !== 'object' || Array.isArray(args)) {
          return rpcError(id, -32602, 'Invalid params: arguments must be an object');
        }
        try {
          const result = await execute(rt, def, args, { ip });
          return rpcOk(id, {
            content: [{ type: 'text', text: JSON.stringify(result.envelope) }],
          });
        } catch (err) {
          if (isApiError(err)) {
            return rpcOk(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: {
                      code: err.code,
                      message: err.message,
                      ...(err.details ? { details: err.details } : {}),
                    },
                  }),
                },
              ],
              isError: true,
            });
          }
          console.error('mcp tool failed:', name, err instanceof Error ? err.message : 'unknown');
          return rpcError(id, -32603, 'Internal error');
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method === 'OPTIONS') return jsonResponse(null, 204);
    if (method === 'GET') {
      return jsonResponse(
        rpcError(null, -32601, 'GET /mcp is not supported; send JSON-RPC 2.0 via POST /mcp.'),
        405,
        { Allow: 'POST, OPTIONS' },
      );
    }
    if (method !== 'POST') {
      return jsonResponse(rpcError(null, -32601, 'Method not allowed'), 405, {
        Allow: 'POST, GET, OPTIONS',
      });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return jsonResponse(rpcError(null, -32600, 'Content-Type must be application/json'), 415);
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_MCP_BODY_BYTES) {
      return jsonResponse(rpcError(null, -32600, 'Request body too large'), 413);
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_MCP_BODY_BYTES) {
      return jsonResponse(rpcError(null, -32600, 'Request body too large'), 413);
    }

    const ip = clientIp(request);
    const rate = await checkMcpRateLimit(deps.db, ip, {
      salt: deps.env?.IP_HASH_SALT,
      now: (deps.now ?? (() => new Date()))(),
      waitUntil: deps.waitUntil ?? null,
      ...opts.rateLimit,
    });
    const rlHeaders = rateLimitHeaders(rate);
    if (!rate.allowed) {
      return jsonResponse(
        rpcError(null, -32029, 'Too many requests. Please try again later.', {
          retry_after: rate.retryAfter,
        }),
        429,
        rlHeaders,
      );
    }

    const parsed = parseJson(rawBody);
    if (!parsed.ok) {
      return jsonResponse(rpcError(null, -32700, 'Parse error'), 400, rlHeaders);
    }

    if (Array.isArray(parsed.value)) {
      if (parsed.value.length === 0 || parsed.value.length > MAX_BATCH_SIZE) {
        return jsonResponse(
          rpcError(null, -32600, `Batch must contain 1 to ${MAX_BATCH_SIZE} requests`),
          400,
          rlHeaders,
        );
      }
      const replies = (
        await Promise.all(parsed.value.map((item) => handleMessage(item, ip)))
      ).filter((r): r is JsonRpcResponse => r !== null);
      if (replies.length === 0) return jsonResponse(null, 202, rlHeaders);
      return jsonResponse(replies, 200, rlHeaders);
    }

    // Single JSON-RPC object (parseJsonObject check ensures plain object)
    if (!parseJsonObject(rawBody)) {
      return jsonResponse(rpcError(null, -32600, 'Invalid Request'), 400, rlHeaders);
    }
    const reply = await handleMessage(parsed.value, ip);
    if (!reply) return jsonResponse(null, 202, rlHeaders);
    return jsonResponse(reply, 200, rlHeaders);
  };
}
