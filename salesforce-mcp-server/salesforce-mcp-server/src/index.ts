#!/usr/bin/env node
/**
 * Salesforce Universal MCP Server
 * Entry point — selects transport based on --transport flag or TRANSPORT env var.
 *
 * Usage:
 *   node dist/index.js                  # stdio (Claude Desktop default)
 *   node dist/index.js --transport http # streamable-HTTP for remote agents
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';
import { createServer } from './server.js';
import { getConfig } from './config.js';

const args = process.argv.slice(2);
const transportArg = args.find((a) => a.startsWith('--transport='))?.split('=')[1]
  ?? args[args.indexOf('--transport') + 1];
const transport = transportArg ?? process.env.TRANSPORT ?? 'stdio';

async function startStdio(): Promise<void> {
  const server = createServer();
  const t = new StdioServerTransport();
  await server.connect(t);
  // stdio: write nothing to stdout except MCP protocol frames
  process.stderr.write('[salesforce-mcp-server] Running on stdio transport\n');
}

async function startHttp(): Promise<void> {
  const config = getConfig();
  const app = express();
  app.use(express.json());

  // Optional API-key guard
  if (config.http.apiKey) {
    app.use('/mcp', (req: Request, res: Response, next: NextFunction) => {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${config.http.apiKey}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Liveness probe (no SF auth needed)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'http', timestamp: new Date().toISOString() });
  });

  // MCP streamable-HTTP endpoint
  app.all('/mcp', async (req: Request, res: Response) => {
    const server = createServer();
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `sf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    await server.connect(t);
    await t.handleRequest(req, res, req.body);
  });

  app.listen(config.http.port, config.http.host, () => {
    process.stderr.write(
      `[salesforce-mcp-server] HTTP transport listening on http://${config.http.host}:${config.http.port}/mcp\n`
    );
  });
}

(async () => {
  try {
    if (transport === 'http') {
      await startHttp();
    } else {
      await startStdio();
    }
  } catch (err) {
    process.stderr.write(`[salesforce-mcp-server] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
})();
