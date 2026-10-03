import NodeCache from 'node-cache';
import { getSalesforceConnection, getConnectionInfo } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { getConfig } from '../config.js';

const cache = new NodeCache();

export async function getOrgDescribeResource(): Promise<string> {
  const config = getConfig();
  const cacheKey = 'resource:org:describe';

  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const conn = await getSalesforceConnection();
  const result = await circuitBreaker.execute(() => conn.describeGlobal(), 'resource:org:describe');

  const summary = result.sobjects.map((obj) => ({
    name: obj.name,
    label: obj.label,
    labelPlural: obj.labelPlural,
    keyPrefix: obj.keyPrefix,
    queryable: obj.queryable,
    createable: obj.createable,
    updateable: obj.updateable,
    deleteable: obj.deleteable,
    custom: obj.custom,
    urls: obj.urls,
  }));

  const output = JSON.stringify(
    {
      totalObjects: summary.length,
      cachedAt: new Date().toISOString(),
      sobjects: summary,
    },
    null,
    2
  );

  cache.set(cacheKey, output, config.cache.globalDescribeTtl);
  return output;
}

export async function getOrgLimitsResource(): Promise<string> {
  const config = getConfig();
  const info = getConnectionInfo();
  const cacheKey = 'resource:org:limits';

  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const conn = await getSalesforceConnection();
  const limits = await circuitBreaker.execute(
    () => (conn as unknown as { limits: () => Promise<unknown> }).limits(),
    'resource:org:limits'
  );

  const output = JSON.stringify(
    {
      retrievedAt: new Date().toISOString(),
      instanceUrl: info?.instanceUrl,
      limits,
    },
    null,
    2
  );

  cache.set(cacheKey, output, config.cache.limitsTtl);
  return output;
}
