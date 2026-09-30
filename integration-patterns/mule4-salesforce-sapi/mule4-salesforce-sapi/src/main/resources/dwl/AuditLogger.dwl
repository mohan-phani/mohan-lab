%dw 2.0

/**
 * AuditLogger — Structured audit log entries for every Salesforce operation.
 *
 * Every call through this SAPI produces an audit log with:
 *   - Who called (caller IP, client ID)
 *   - What operation (query, create, update, etc.)
 *   - Which sObject
 *   - How many records
 *   - How long it took
 *   - Whether it succeeded or failed
 *
 * Designed for ingestion by Splunk, ELK, Datadog, or compliance systems.
 */

/**
 * Builds an audit log entry for a successful operation.
 */
fun buildAuditLog(
    level: String,
    operation: String,
    sObjectType: String,
    recordCount: Number,
    startTime,
    correlationId: String,
    reqAttributes
) = {
    logType: "SFDC_AUDIT",
    level: level,
    timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
    correlationId: correlationId,
    operation: operation,
    sObject: sObjectType,
    recordCount: recordCount,
    durationMs: if (startTime != null)
        (now() as Number {unit: "milliseconds"}) - (startTime as Number {unit: "milliseconds"})
    else null,
    request: extractRequestContext(reqAttributes)
}

/**
 * Builds an audit log entry for an error.
 */
fun buildAuditLog(
    level: String,
    errorCategory: String,
    muleError,
    correlationId: String,
    reqAttributes
) = {
    logType: "SFDC_AUDIT",
    level: level,
    timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
    correlationId: correlationId,
    operation: "ERROR",
    errorCategory: errorCategory,
    errorType: (muleError.errorType.namespace default "MULE") ++ ":" ++ (muleError.errorType.identifier default "UNKNOWN"),
    errorMessage: muleError.description default "Unknown error",
    request: extractRequestContext(reqAttributes)
}

/**
 * Extracts request context safely.
 */
fun extractRequestContext(reqAttributes) =
    if (reqAttributes != null and reqAttributes.method != null)
        {
            method: reqAttributes.method,
            path: reqAttributes.requestUri default "unknown",
            remoteAddress: reqAttributes.remoteAddress default "unknown",
            clientId: reqAttributes.headers.'x-client-id' default reqAttributes.headers.'client_id' default "anonymous"
        }
    else
        { method: "N/A", path: "N/A", remoteAddress: "N/A", clientId: "N/A" }
