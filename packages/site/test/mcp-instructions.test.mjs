import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MCP_INSTRUCTIONS,
  addMcpInstructions,
  initializeIds,
  isMcpPath,
} from '../dist/runtime/mcp-instructions.js';

const URL_ = 'https://acme.himlio.app/_emdash/api/mcp';
const req = (body) => new Request(URL_, { method: 'POST', body: JSON.stringify(body) });
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
const result = {
  jsonrpc: '2.0',
  id: 1,
  result: { protocolVersion: '2025-06-18', serverInfo: { name: 'emdash' } },
};

test('the guidance tells connectors to publish, and where contact details live', () => {
  assert.match(MCP_INSTRUCTIONS, /status: "published"/);
  assert.match(MCP_INSTRUCTIONS, /content_publish/);
  assert.match(MCP_INSTRUCTIONS, /"company"/);
});

test('only the MCP endpoint is matched', () => {
  assert.equal(isMcpPath(new URL(URL_)), true);
  assert.equal(isMcpPath(new URL('https://a.se/_emdash//api/MCP/')), true);
  assert.equal(isMcpPath(new URL('https://a.se/_emdash/api/content')), false);
});

test('JSON answer to initialize gets the instructions', async () => {
  const ids = await initializeIds(req(init));
  const res = await addMcpInstructions(Response.json(result), ids);
  assert.equal((await res.json()).result.instructions, MCP_INSTRUCTIONS);
});

test('SSE answer to initialize gets the instructions', async () => {
  const ids = await initializeIds(req(init));
  const sse = new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
  const text = await (await addMcpInstructions(sse, ids)).text();
  const data = JSON.parse(
    text
      .split('\n')
      .find((l) => l.startsWith('data:'))
      .slice(5)
  );
  assert.equal(data.result.instructions, MCP_INSTRUCTIONS);
  assert.match(text, /^event: message\n/);
});

test('other calls and errors are passed through unchanged', async () => {
  const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {} };
  assert.equal((await initializeIds(req(call))).size, 0);
  const res = Response.json({ jsonrpc: '2.0', id: 2, result: { content: [] } });
  assert.equal(await addMcpInstructions(res, new Set()), res);
  const err = new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
  assert.equal(await addMcpInstructions(err, new Set([1])), err);
});

test('batches: only the initialize answer is changed; existing instructions are kept', async () => {
  const ids = await initializeIds(req([init, { jsonrpc: '2.0', id: 3, method: 'tools/list' }]));
  const withOwn = { ...result, result: { ...result.result, instructions: 'EmDash says hi.' } };
  const res = await addMcpInstructions(
    Response.json([withOwn, { jsonrpc: '2.0', id: 3, result: {} }]),
    ids
  );
  const [a, b] = await res.json();
  assert.equal(a.result.instructions, `EmDash says hi.\n\n${MCP_INSTRUCTIONS}`);
  assert.deepEqual(b.result, {});
});
