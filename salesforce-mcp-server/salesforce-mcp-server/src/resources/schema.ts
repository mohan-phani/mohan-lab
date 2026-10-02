import NodeCache from 'node-cache';
import { getSalesforceConnection } from '../auth/sf-auth.js';
import { circuitBreaker } from '../guardrails/circuit-breaker.js';
import { getConfig } from '../config.js';

const cache = new NodeCache();

export async function getSchemaResource(sObjectType: string): Promise<string> {
  const config = getConfig();
  const cacheKey = `resource:schema:${sObjectType.toLowerCase()}`;

  const cached = cache.get<string>(cacheKey);
  if (cached) return cached;

  const conn = await getSalesforceConnection();
  const result = await circuitBreaker.execute(
    () => conn.sobject(sObjectType).describe(),
    `resource:schema:${sObjectType}`
  );

  // Return a rich but agent-friendly schema summary
  const schema = {
    name: result.name,
    label: result.label,
    labelPlural: result.labelPlural,
    keyPrefix: result.keyPrefix,
    cachedAt: new Date().toISOString(),
    capabilities: {
      queryable: result.queryable,
      createable: result.createable,
      updateable: result.updateable,
      deleteable: result.deleteable,
      searchable: result.searchable,
    },
    fields: result.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      length: f.length,
      nillable: f.nillable,
      createable: f.createable,
      updateable: f.updateable,
      unique: f.unique,
      externalId: f.externalId,
      filterable: f.filterable,
      sortable: f.sortable,
      referenceTo: f.referenceTo,
      relationshipName: f.relationshipName,
      picklistValues: f.picklistValues?.filter((p) => p.active).map((p) => ({
        value: p.value,
        label: p.label,
        defaultValue: p.defaultValue,
      })),
    })),
    recordTypes: result.recordTypeInfos?.map((rt) => ({
      id: rt.recordTypeId,
      name: rt.name,
      developerName: rt.developerName,
      active: rt.active,
      defaultRecordTypeMapping: rt.defaultRecordTypeMapping,
    })),
  };

  const output = JSON.stringify(schema, null, 2);
  cache.set(cacheKey, output, config.cache.schemaTtl);
  return output;
}
