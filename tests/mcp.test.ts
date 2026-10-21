import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp.js';
import { Knowledge } from '../src/knowledge.js';
import { FixtureReader } from './fixtures.js';

test('MCP handshake, tools/list, validated calls and error results', async () => {
  const server = createServer(new Knowledge(new FixtureReader()));
  const client = new Client({ name: 'test-client', version: '1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listing = await client.listTools();
    assert.equal(listing.tools.length, 10);
    assert.ok(listing.tools.every(tool => tool.annotations?.readOnlyHint));
    const result = await client.callTool({ name: 'find_recipes', arguments: { item_id: 'minecraft:iron_ingot' } });
    assert.ok(!result.isError);
    const content = result.content as { type: string; text: string }[];
    assert.equal(JSON.parse(content[0]!.text).direction, 'produces');
    const error = await client.callTool({ name: 'get_recipe', arguments: { recipe_id: '../bad' } });
    assert.equal(error.isError, true);
    const invalid = await client.callTool({ name: 'search', arguments: { query: 'iron', limit: 100000 } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});
