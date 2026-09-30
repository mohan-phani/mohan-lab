%dw 2.0

/**
 * ErrorLogBuilder — Produces structured JSON log entries for observability.
 *
 * Designed for ingestion by Splunk, ELK, Datadog, or any JSON-aware log
 * aggregator. Includes correlation, request context, error classification,
 * and timing — everything an SRE needs to triage without asking a developer.
 *
 * Usage in DataWeave:
 *   import * from dwl::ErrorLogBuilder
 *   buildErrorLog(500, "INTERNAL_SERVER_ERROR", error, correlationId, attributes)
 */

/**
 * Builds a structured log entry for an error event.
 *
 * @param httpStatus    - The HTTP status being returned
 * @param errorCategory - Machine-readable category
 * @param muleError     - The Mule error object
 * @param correlationId - Mule correlationId
 * @param reqAttributes - HTTP request attributes (method, path, headers, etc.)
 * @return JSON object suitable for structured logging
 */
fun buildErrorLog(httpStatus: Number, errorCategory: String, muleError, correlationId: String, reqAttributes) =
    {
        logLevel: if (httpStatus >= 500) "ERROR" else "WARN",
        logType: "API_ERROR",
        timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
        correlationId: correlationId,
        error: {
            category: errorCategory,
            httpStatus: httpStatus,
            errorType: (muleError.errorType.namespace default "MULE") ++ ":" ++ (muleError.errorType.identifier default "UNKNOWN"),
            message: muleError.description default "No description available",
            cause: muleError.cause.message default null
        },
        request: buildRequestContext(reqAttributes)
    }

/**
 * Extracts request context from HTTP listener attributes.
 * Safely handles null attributes (e.g., when error occurs in non-HTTP flows).
 *
 * @param reqAttributes - The HTTP request attributes object
 * @return Request context object
 */
fun buildRequestContext(reqAttributes) =
    if (reqAttributes != null and reqAttributes.method != null)
        {
            method: reqAttributes.method,
            path: reqAttributes.requestUri default reqAttributes.requestPath default "unknown",
            queryParams: reqAttributes.queryParams default {},
            remoteAddress: reqAttributes.remoteAddress default "unknown",
            userAgent: reqAttributes.headers.'user-agent' default "unknown"
        }
    else
        {
            method: "N/A",
            path: "non-http-flow",
            queryParams: {},
            remoteAddress: "N/A",
            userAgent: "N/A"
        }
