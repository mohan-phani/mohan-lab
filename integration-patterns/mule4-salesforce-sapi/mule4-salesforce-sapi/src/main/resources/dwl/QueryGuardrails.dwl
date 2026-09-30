%dw 2.0

/**
 * QueryGuardrails — SOQL validation and sanitization.
 *
 * Prevents:
 *   - SOQL injection (embedded DML, comments, multi-statement)
 *   - Oversized queries that blow up SF governor limits
 *   - SELECT * anti-patterns (SF doesn't support it, but callers try)
 *   - Empty or whitespace-only queries
 *
 * This is NOT a security boundary — it's a guardrail for developer mistakes.
 */

/**
 * Validates a SOQL query and returns a validation result object.
 *
 * @param soql    - The raw SOQL query string
 * @param maxLen  - Max allowed query length
 * @return { valid: Boolean, errors: Array<String>, sanitized: String }
 */
fun validateSoql(soql: String | Null, maxLen: Number) =
    do {
        var trimmed = trim(soql default "")
        var errors = []
            // Empty check
            ++ (if (isEmpty(trimmed)) ["Query cannot be empty"] else [])
            // Length check
            ++ (if (sizeOf(trimmed) > maxLen) ["Query exceeds maximum length of $(maxLen) characters (got $(sizeOf(trimmed)))"] else [])
            // Must start with SELECT, FIND, or be a relationship query
            ++ (if (!isEmpty(trimmed) and !(upper(trimmed) matches /^(SELECT|FIND)\s.*/)) ["Query must start with SELECT or FIND"] else [])
            // Block DML keywords embedded in queries
            ++ (if (upper(trimmed) matches /.*\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|UNDELETE)\b.*/) ["DML operations (INSERT/UPDATE/DELETE) are not allowed in query endpoint. Use the appropriate CRUD endpoint."] else [])
            // Block comments (potential injection vector)
            ++ (if (trimmed contains "/*" or trimmed contains "--") ["SQL comments are not allowed in SOQL queries"] else [])
            // Block semicolons (multi-statement)
            ++ (if (trimmed contains ";") ["Multi-statement queries (semicolons) are not allowed"] else [])
            // Block SELECT * (SF doesn't support it)
            ++ (if (upper(trimmed) matches /^SELECT\s+\*\s+FROM.*/) ["SELECT * is not supported in SOQL. Specify field names explicitly."] else [])
        ---
        {
            valid: isEmpty(errors),
            errors: errors,
            sanitized: if (isEmpty(errors)) trimmed else ""
        }
    }

/**
 * Computes a complexity score for a SOQL query.
 * Used to warn callers about potentially expensive queries.
 *
 * Scoring:
 *   - Base: 1
 *   - Subquery: +3 per nested SELECT
 *   - JOIN (relationship): +2
 *   - Aggregate function: +2
 *   - LIKE with leading wildcard: +2
 *   - No LIMIT clause: +1
 *   - No WHERE clause: +3 (full table scan)
 *
 * @param soql - The validated SOQL query
 * @return { score: Number, warnings: Array<String> }
 */
fun queryComplexity(soql: String) =
    do {
        var upperSoql = upper(soql)
        var score = 1
            + (if (sizeOf(upperSoql scan /\(SELECT/) > 0) sizeOf(upperSoql scan /\(SELECT/) * 3 else 0)
            + (if (upperSoql contains ".") 2 else 0)
            + (if (upperSoql matches /.*\b(COUNT|SUM|AVG|MIN|MAX|GROUP BY)\b.*/) 2 else 0)
            + (if (upperSoql matches /.*LIKE\s+'%.*/) 2 else 0)
            + (if (!(upperSoql contains "LIMIT")) 1 else 0)
            + (if (!(upperSoql contains "WHERE")) 3 else 0)
        var warnings = []
            ++ (if (score >= 8) ["HIGH complexity query — consider adding WHERE/LIMIT clauses"] else [])
            ++ (if (!(upperSoql contains "LIMIT")) ["No LIMIT clause — results may be large"] else [])
            ++ (if (!(upperSoql contains "WHERE")) ["No WHERE clause — full table scan on sObject"] else [])
            ++ (if (sizeOf(upperSoql scan /\(SELECT/) > 2) ["Multiple subqueries detected — may hit SF governor limits"] else [])
        ---
        {
            score: score,
            warnings: warnings
        }
    }
