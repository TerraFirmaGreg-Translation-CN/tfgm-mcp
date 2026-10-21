#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './mcp.js';

const server = createServer();
await server.connect(new StdioServerTransport());
process.on('SIGINT', () => { void server.close(); });
process.on('SIGTERM', () => { void server.close(); });
