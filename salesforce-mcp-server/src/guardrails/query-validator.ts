import { getConfig } from '../config.js';
import type { QueryValidationResult } from '../types/salesforce.js';

// DML keywords that must never appear in a SOQL query
const DML_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'EXEC',
  'EXECUTE',
  'CALL',
  'GRANT',
  'REVOKE',
];

// SQL comment patterns (SOQL has no comment syntax, so any comment = injection attempt)
const SQL_COMMENT_PATTERNS = [
  /--/,          // line comment
  /\/\*/,        // block comment open
  /\*\//,        // block comment close
  /;/,           // statement terminator
  /\bXP_\w+/i,  // xp_ stored procs (SQL Server leak)
];

export function validateQuery(soql: string): QueryValidationResult {
  const config = getConfig();
  const violations: string[] = [];
  const warnings: string[] = [];
  let complexityScore = 0;

  // --- Guard: empty / whitespace-only ---
  if (!soql || soql.trim().length === 0) {
    return {
      valid: false,
      complexityScore: 0,
      violations: ['Query must not be empty'],
      warnings: [],
    };
  }

  const trimmed = soql.trim();

  // --- Guard: oversized query ---
  if (trimmed.length > config.query.maxLength) {
    violations.push(
      `Query exceeds maximum length of ${config.query.maxLength} characters (got ${trimmed.length})`
    );
  }

  // --- Guard: must start with SELECT or FIND (SOSL uses FIND) ---
  const upperTrimmed = trimmed.toUpperCase();
  if (!upperTrimmed.startsWith('SELECT') && !upperTrimmed.startsWith('FIND')) {
    violations.push('Query must start with SELECT (SOQL) or FIND (SOSL)');
  }

  // --- Guard: DML keyword detection ---
  // Tokenise on word boundaries to avoid false positives (e.g. "Created_Date")
  const tokens = upperTrimmed.split(/\s+|[(),=<>!+\-*/]/);
  for (const kw of DML_KEYWORDS) {
    if (tokens.includes(kw)) {
      violations.push(`DML keyword '${kw}' detected in SOQL query`);
    }
  }

  // --- Guard: SQL comment / injection patterns ---
  for (const pattern of SQL_COMMENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      violations.push(`Injection pattern detected: ${pattern.source}`);
    }
  }

  // --- Guard: SELECT * (invalid SOQL and potential data exfil) ---
  if (/SELECT\s+\*/i.test(trimmed)) {
    violations.push("SELECT * is not valid SOQL — specify explicit field names");
  }

  // --- Complexity: subqueries (each nested SELECT adds 2) ---
  const subqueryMatches = trimmed.match(/\(\s*SELECT\b/gi);
  if (subqueryMatches) {
    const penalty = subqueryMatches.length * 2;
    complexityScore += penalty;
    if (subqueryMatches.length > 2) {
      warnings.push(`${subqueryMatches.length} subqueries detected — consider splitting into separate queries`);
    }
  }

  // --- Complexity: missing WHERE clause (+3) ---
  if (!/\bWHERE\b/i.test(trimmed) && !/\bFIND\b/i.test(trimmed)) {
    complexityScore += 3;
    warnings.push('No WHERE clause — query will scan all records');
  }

  // --- Complexity: missing LIMIT clause (+2) ---
  if (!/\bLIMIT\b/i.test(trimmed)) {
    complexityScore += 2;
    warnings.push('No LIMIT clause — result set is unbounded');
  }

  // --- Complexity: aggregate functions (+1 each) ---
  const aggregates = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'];
  for (const agg of aggregates) {
    const regex = new RegExp(`\\b${agg}\\s*\\(`, 'i');
    if (regex.test(trimmed)) {
      complexityScore += 1;
    }
  }

  // --- Complexity: leading wildcard LIKE (full scan) (+2) ---
  if (/LIKE\s+['"]%/i.test(trimmed)) {
    complexityScore += 2;
    warnings.push("Leading wildcard LIKE '%...' prevents index use and causes full table scan");
  }

  // --- Complexity: OFFSET without LIMIT ---
  if (/\bOFFSET\b/i.test(trimmed) && !/\bLIMIT\b/i.test(trimmed)) {
    complexityScore += 1;
    warnings.push('OFFSET without LIMIT is unusual — verify intent');
  }

  // --- Complexity threshold check ---
  if (complexityScore >= config.query.complexityThreshold) {
    violations.push(
      `Query complexity score ${complexityScore} meets or exceeds threshold ${config.query.complexityThreshold}. ` +
        `Add WHERE/LIMIT clauses or simplify to reduce complexity.`
    );
  }

  return {
    valid: violations.length === 0,
    complexityScore,
    violations,
    warnings,
  };
}

/**
 * Lightweight sanitiser: escapes single quotes in a user-supplied string value
 * to prevent SOQL injection when constructing queries programmatically.
 */
export function escapeSoqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Check if an identifier (field name, object name) is safe to interpolate
 * directly into SOQL without quoting — only alphanumerics and underscores.
 */
export function isSafeIdentifier(identifier: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*(__c|__r)?$/.test(identifier);
}
