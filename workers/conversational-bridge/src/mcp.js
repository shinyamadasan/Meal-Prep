// TASK-067 feasibility adapter only. These probes intentionally have no environment, domain,
// Firestore, or network dependency; real meal-prep tools are explicitly out of scope.
import {
  McpServer,
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse
} from '@modelcontextprotocol/server';
import { z } from 'zod';

const MAX_MCP_BODY_BYTES = 8 * 1024;
const PRODUCTION_HOSTNAME = 'meal-prep-conversational-bridge.shinyamadasan.workers.dev';
const ALLOWED_HOSTNAMES = localhostAllowedHostnames().concat(PRODUCTION_HOSTNAME);
const ALLOWED_ORIGIN_HOSTNAMES = localhostAllowedOrigins().concat(PRODUCTION_HOSTNAME);

function toolResult(data) {
  return {
    structuredContent: data,
    content: [{ type: 'text', text: JSON.stringify(data) }]
  };
}

function createProbeServer() {
  const server = new McpServer({
    name: 'meal-prep-mcp-feasibility-probes',
    version: '1.0.0'
  });

  server.registerTool(
    'probe_read',
    {
      title: 'Read capability probe',
      description: 'Returns static capability data without reading user data or external state.',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        probe: z.literal('read')
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false
      }
    },
    async () => toolResult({ ok: true, probe: 'read' })
  );

  server.registerTool(
    'probe_write',
    {
      title: 'Write-classified capability probe',
      description: 'Returns static capability data. This write-classified feasibility probe is a pure no-op.',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        probe: z.literal('write-classified-noop')
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => toolResult({ ok: true, probe: 'write-classified-noop' })
  );

  return server;
}

// Official SDK v2 Web-standard Streamable HTTP handler. It creates a fresh server per request,
// keeps the endpoint stateless, and retains the legacy initialize flow ChatGPT clients may use.
const mcpHandler = createMcpHandler(createProbeServer, {
  legacy: 'stateless',
  maxRequestBodySize: MAX_MCP_BODY_BYTES
});

export function handleMcpRequest(request) {
  const rejected =
    hostHeaderValidationResponse(request, ALLOWED_HOSTNAMES) ||
    originValidationResponse(request, ALLOWED_ORIGIN_HOSTNAMES);
  return rejected || mcpHandler.fetch(request);
}
