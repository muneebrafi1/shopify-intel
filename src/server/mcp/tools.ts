/**
 * Read-only MCP tools derived directly from the API v1 endpoint registry (`endpointList`).
 * Only GET endpoints (excluding the API index) become tools — POST endpoints like removal
 * requests are never exposed. Input schemas come straight from Zod via `z.toJSONSchema`.
 */
import { z } from 'zod';
import type { EndpointDef } from '../api/v1/define.ts';
import { endpointList } from '../api/v1/registry.ts';

export interface McpToolAnnotations {
  readOnlyHint: true;
  destructiveHint: false;
  idempotentHint: true;
  openWorldHint: false;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: McpToolAnnotations;
}

export interface McpToolMeta {
  name: string;
  summary: string;
  group: string;
}

const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function toInputSchema(def: EndpointDef): Record<string, unknown> {
  const schema = z.toJSONSchema(def.input, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  const { $schema: _s, $id: _i, ...rest } = schema;
  if (!rest.type) rest.type = 'object';
  if (!rest.properties) rest.properties = {};
  return rest;
}

const readEndpoints = endpointList.filter((e) => e.method === 'GET' && e.id !== 'index');

export const mcpToolMap: ReadonlyMap<string, EndpointDef> = new Map(
  readEndpoints.map((def) => [def.id, def]),
);

export const mcpTools: readonly McpTool[] = readEndpoints.map((def) => ({
  name: def.id,
  title: def.summary,
  description: def.description ? `${def.summary}. ${def.description}` : def.summary,
  inputSchema: toInputSchema(def),
  annotations: READ_ONLY_ANNOTATIONS,
}));

export const mcpToolMeta: readonly McpToolMeta[] = readEndpoints.map((def) => ({
  name: def.id,
  summary: def.summary,
  group: def.tags[0] ?? 'Other',
}));
