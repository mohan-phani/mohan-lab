import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../config.js';
import type { AuditLogEntry, SalesforceOperation } from '../types/salesforce.js';

class AuditLogger {
  private logFile: fs.WriteStream | null = null;

  private getStream(): fs.WriteStream | null {
    const config = getConfig();
    if (config.logging.transport !== 'file') return null;

    if (!this.logFile) {
      const dir = path.dirname(config.logging.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.logFile = fs.createWriteStream(config.logging.filePath, { flags: 'a' });
    }
    return this.logFile;
  }

  log(entry: AuditLogEntry): void {
    const config = getConfig();
    const json = JSON.stringify(entry);

    const level = entry.success ? 'info' : 'error';
    if (!this.shouldLog(level, config.logging.level)) return;

    const stream = this.getStream();
    if (stream) {
      stream.write(json + '\n');
    } else {
      // eslint-disable-next-line no-console
      console.log(json);
    }
  }

  private shouldLog(
    entryLevel: 'debug' | 'info' | 'warn' | 'error',
    configLevel: 'debug' | 'info' | 'warn' | 'error'
  ): boolean {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[entryLevel] >= levels[configLevel];
  }
}

export const auditLogger = new AuditLogger();

export interface AuditContext {
  correlationId: string;
  caller: string;
  operation: SalesforceOperation;
  sObject?: string;
  soql?: string;
  recordId?: string;
  instanceUrl?: string;
  apiVersion: string;
}

export function logAudit(
  ctx: AuditContext,
  result: { success: boolean; recordCount?: number; errorCode?: string; errorMessage?: string },
  durationMs: number
): void {
  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    correlationId: ctx.correlationId,
    caller: ctx.caller,
    operation: ctx.operation,
    sObject: ctx.sObject,
    soql: ctx.soql,
    recordId: ctx.recordId,
    success: result.success,
    recordCount: result.recordCount,
    durationMs,
    apiVersion: ctx.apiVersion,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    instanceUrl: ctx.instanceUrl,
  };
  auditLogger.log(entry);
}
