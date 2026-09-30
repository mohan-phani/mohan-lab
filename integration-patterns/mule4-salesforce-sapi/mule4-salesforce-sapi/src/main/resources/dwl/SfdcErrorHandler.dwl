%dw 2.0

/**
 * SfdcErrorHandler — Builds structured error responses for Salesforce operations.
 * Extracts Salesforce-specific error codes (MALFORMED_QUERY, INVALID_FIELD, etc.)
 * from the error description and surfaces them to the consumer.
 */

fun buildSfdcErrorResponse(
    httpStatus: Number,
    errorCategory: String,
    errorTitle: String,
    errorDetail: String,
    muleError,
    correlationId: String
) = {
    success: false,
    error: {
        status: httpStatus,
        category: errorCategory,
        title: errorTitle,
        detail: sanitizeSfdcMessage(errorDetail),
        sfdcErrorCode: extractSfdcErrorCode(errorDetail),
        errorType: (muleError.errorType.namespace default "MULE") ++ ":" ++ (muleError.errorType.identifier default "UNKNOWN"),
        correlationId: correlationId,
        timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"}
    }
}

/**
 * Extracts the Salesforce error code from the error message if present.
 * Salesforce errors follow the pattern: MALFORMED_QUERY: ..., INVALID_FIELD: ...
 */
fun extractSfdcErrorCode(message: String): String | Null =
    if (message matches /^[A-Z_]+:.*/)
        (message splitBy ":")[0] trim
    else
        null

/**
 * Sanitizes Salesforce error messages for consumer safety.
 * Keeps SOQL-related messages (useful for debugging) but strips Java internals.
 */
fun sanitizeSfdcMessage(message: String): String =
    if (message contains "com.mulesoft" or message contains "org.mule" or message contains "java.")
        "A Salesforce processing error occurred. Check the correlationId with support."
    else if (sizeOf(message) > 1000)
        message[0 to 999] ++ "..."
    else
        message
