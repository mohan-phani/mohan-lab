/**
 * Tests for SOQL injection prevention and complexity scoring.
 * These guardrails are the primary differentiator of this MCP server.
 */

// Mock config so tests don't need a .env
jest.mock('../src/config', () => ({
  getConfig: () => ({
    query: { maxLength: 10000, complexityThreshold: 8 },
    auth: { apiVersion: '62.0' },
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 },
    cache: { globalDescribeTtl: 300, schemaTtl: 300, limitsTtl: 60 },
    logging: { level: 'error', transport: 'console', filePath: '' },
    http: { port: 3000, host: '0.0.0.0' },
  }),
}));

import { validateQuery, escapeSoqlString, isSafeIdentifier } from '../src/guardrails/query-validator';

describe('validateQuery — basic guards', () => {
  test('rejects empty query', () => {
    const r = validateQuery('');
    expect(r.valid).toBe(false);
    expect(r.violations).toContain('Query must not be empty');
  });

  test('rejects whitespace-only query', () => {
    const r = validateQuery('   \n\t  ');
    expect(r.valid).toBe(false);
    expect(r.violations[0]).toMatch(/empty/i);
  });

  test('rejects oversized query', () => {
    const bigQuery = 'SELECT Id FROM Account WHERE ' + 'x'.repeat(10000);
    const r = validateQuery(bigQuery);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('maximum length'))).toBe(true);
  });

  test('rejects query that does not start with SELECT or FIND', () => {
    const r = validateQuery('SHOW TABLES');
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('must start with SELECT'))).toBe(true);
  });

  test('accepts valid SELECT query', () => {
    const r = validateQuery('SELECT Id, Name FROM Account WHERE Name = \'Acme\' LIMIT 10');
    expect(r.valid).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  test('accepts valid FIND (SOSL) query', () => {
    const r = validateQuery('FIND {Acme*} IN ALL FIELDS RETURNING Account(Id, Name)');
    expect(r.valid).toBe(true);
  });
});

describe('validateQuery — DML injection detection', () => {
  const dmlCases = [
    ['DELETE', 'DELETE FROM Account'],
    ['INSERT', 'INSERT INTO Account (Name) VALUES (\'Acme\')'],
    ['UPDATE', 'UPDATE Account SET Name=\'Acme\' WHERE Id=\'001\''],
    ['MERGE', 'MERGE INTO Account'],
    ['UPSERT', 'UPSERT Account'],
    ['DROP', 'DROP TABLE Account'],
    ['CREATE', 'CREATE TABLE Account'],
    ['TRUNCATE', 'TRUNCATE TABLE Account'],
    ['EXEC', 'EXEC sp_someproc'],
  ];

  test.each(dmlCases)('rejects %s keyword', (keyword, query) => {
    const r = validateQuery(query);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes(keyword))).toBe(true);
  });

  test('does not false-positive on "Created_Date__c" field name', () => {
    // "CREATE" appears inside a field name — should NOT trigger
    const r = validateQuery('SELECT Id, Created_Date__c FROM Account WHERE Id = \'001abc\' LIMIT 1');
    // Only check that CREATE didn't trip the DML guard
    expect(r.violations.some((v) => v.includes("DML keyword 'CREATE'"))).toBe(false);
  });
});

describe('validateQuery — SQL comment injection', () => {
  test('rejects line comments (--)', () => {
    const r = validateQuery("SELECT Id FROM Account WHERE Id = '001' -- OR 1=1");
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('Injection pattern'))).toBe(true);
  });

  test('rejects block comment open (/*)', () => {
    const r = validateQuery('SELECT Id FROM Account /* comment */');
    expect(r.valid).toBe(false);
  });

  test('rejects semicolons (multi-statement)', () => {
    const r = validateQuery("SELECT Id FROM Account; DELETE FROM Account");
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes(';') || v.includes('Injection pattern'))).toBe(true);
  });
});

describe('validateQuery — SELECT * prevention', () => {
  test('rejects SELECT *', () => {
    const r = validateQuery('SELECT * FROM Account');
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.includes('SELECT *'))).toBe(true);
  });
});

describe('validateQuery — complexity scoring', () => {
  test('scores 0 for a well-formed query', () => {
    const r = validateQuery('SELECT Id, Name FROM Account WHERE Name = \'Acme\' LIMIT 10');
    expect(r.complexityScore).toBe(0);
    expect(r.valid).toBe(true);
  });

  test('adds +3 for missing WHERE clause', () => {
    const r = validateQuery('SELECT Id, Name FROM Account LIMIT 10');
    expect(r.complexityScore).toBeGreaterThanOrEqual(3);
  });

  test('adds +2 for missing LIMIT clause', () => {
    const r = validateQuery("SELECT Id, Name FROM Account WHERE Name = 'Acme'");
    expect(r.complexityScore).toBeGreaterThanOrEqual(2);
  });

  test('adds +2 per subquery', () => {
    const r = validateQuery(
      "SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Id = '001' LIMIT 10"
    );
    expect(r.complexityScore).toBeGreaterThanOrEqual(2);
  });

  test('adds +1 for COUNT aggregate', () => {
    const r = validateQuery('SELECT COUNT(Id) FROM Account WHERE Name = \'Acme\' LIMIT 1');
    expect(r.complexityScore).toBeGreaterThanOrEqual(1);
  });

  test('adds +2 for leading wildcard LIKE', () => {
    const r = validateQuery("SELECT Id FROM Account WHERE Name LIKE '%Acme' LIMIT 10");
    expect(r.complexityScore).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes('wildcard'))).toBe(true);
  });

  test('rejects query at or above threshold (score >= 8)', () => {
    // Missing WHERE (+3) + missing LIMIT (+2) + 2 subqueries (+4) = 9
    const r = validateQuery(
      'SELECT Id, (SELECT Id FROM Contacts), (SELECT Id FROM Cases) FROM Account'
    );
    expect(r.complexityScore).toBeGreaterThanOrEqual(8);
    expect(r.valid).toBe(false);
  });

  test('warns but accepts query just below threshold', () => {
    // Missing WHERE (+3) + missing LIMIT (+2) = 5 — below threshold of 8
    const r = validateQuery('SELECT Id, Name FROM Account');
    expect(r.complexityScore).toBeLessThan(8);
    // Warnings about missing WHERE and LIMIT
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateQuery — warnings', () => {
  test('warns about missing WHERE clause', () => {
    const r = validateQuery('SELECT Id, Name FROM Account LIMIT 10');
    expect(r.warnings.some((w) => w.includes('WHERE'))).toBe(true);
  });

  test('warns about missing LIMIT clause', () => {
    const r = validateQuery("SELECT Id, Name FROM Account WHERE Name = 'Acme'");
    expect(r.warnings.some((w) => w.includes('LIMIT'))).toBe(true);
  });

  test('warns about leading wildcard', () => {
    const r = validateQuery("SELECT Id FROM Account WHERE Name LIKE '%Corp' LIMIT 5");
    expect(r.warnings.some((w) => w.includes('wildcard'))).toBe(true);
  });
});

describe('escapeSoqlString', () => {
  test('escapes single quotes', () => {
    expect(escapeSoqlString("O'Brien")).toBe("O\\'Brien");
  });

  test('escapes backslashes', () => {
    expect(escapeSoqlString('C:\\Users')).toBe('C:\\\\Users');
  });

  test('leaves safe strings unchanged', () => {
    expect(escapeSoqlString('Acme Corp')).toBe('Acme Corp');
  });
});

describe('isSafeIdentifier', () => {
  test('accepts standard field names', () => {
    expect(isSafeIdentifier('Name')).toBe(true);
    expect(isSafeIdentifier('BillingCity')).toBe(true);
    expect(isSafeIdentifier('My_Field__c')).toBe(true);
    expect(isSafeIdentifier('My_Lookup__r')).toBe(true);
  });

  test('rejects names with spaces or special chars', () => {
    expect(isSafeIdentifier('Name; DROP')).toBe(false);
    expect(isSafeIdentifier('Field Name')).toBe(false);
    expect(isSafeIdentifier("Name'")).toBe(false);
    expect(isSafeIdentifier('Field-Name')).toBe(false);
  });

  test('rejects names starting with digits', () => {
    expect(isSafeIdentifier('1Field')).toBe(false);
  });
});
