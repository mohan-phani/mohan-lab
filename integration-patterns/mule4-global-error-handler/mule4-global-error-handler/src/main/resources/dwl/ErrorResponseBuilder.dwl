%dw 2.0

/**
 * ErrorResponseBuilder — Constructs RFC 7807-inspired structured error payloads.
 *
 * Why RFC 7807? It's the standard "Problem Details for HTTP APIs" format.
 * Consumers can programmatically parse errors instead of guessing from
 * status codes alone. This module adapts the spirit of the spec to
 * MuleSoft's error model.
 *
 * Usage in DataWeave:
 *   import * from dwl::ErrorResponseBuilder
 *   buildErrorResponse(400, "BAD_REQUEST", "Bad Request", error, correlationId)
 */

/**
 * Builds the full error response payload.
 *
 * @param httpStatus    - HTTP status code (e.g. 400, 500)
 * @param errorCategory - Machine-readable category (e.g. "BAD_REQUEST")
 * @param errorTitle    - Human-readable title
 * @param muleError     - The Mule error object from the error handler
 * @param correlationId - The Mule correlationId for tracing
 * @return Structured error JSON object
 */
fun buildErrorResponse(httpStatus: Number, errorCategory: String, errorTitle: String, muleError, correlationId: String) =
    {
        success: false,
        error: {
            status: httpStatus,
            category: errorCategory,
            title: errorTitle,
            detail: sanitizeMessage(muleError.description default "An unexpected error occurred"),
            errorType: (muleError.errorType.namespace default "MULE") ++ ":" ++ (muleError.errorType.identifier default "UNKNOWN"),
            correlationId: correlationId,
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"}
        }
    }

/**
 * Sanitizes error messages to avoid leaking internal details in production.
 * Strips stack traces, Java class names, and connection strings.
 *
 * @param message - Raw error description from the Mule runtime
 * @return Cleaned message safe for API consumers
 */
fun sanitizeMessage(message: String): String =
    if (message contains "com.mulesoft" or message contains "org.mule" or message contains "java.")
        "An internal processing error occurred. Please contact support with the correlationId."
    else if (sizeOf(message) > 500)
        message[0 to 499] ++ "..."
    else
        message

/**
 * Maps a Mule error type namespace:identifier to an HTTP status code.
 * Useful when you want to derive the status from the error itself
 * rather than from the on-error-propagate type attribute.
 *
 * @param errorType - The Mule error type object
 * @return HTTP status code as Number
 */
fun errorTypeToHttpStatus(errorType) : Number =
    errorType.identifier match {
        case "BAD_REQUEST"           -> 400
        case "UNAUTHORIZED"          -> 401
        case "FORBIDDEN"             -> 403
        case "NOT_FOUND"             -> 404
        case "METHOD_NOT_ALLOWED"    -> 405
        case "NOT_ACCEPTABLE"        -> 406
        case "UNSUPPORTED_MEDIA_TYPE"-> 415
        case "TOO_MANY_REQUESTS"     -> 429
        case "TIMEOUT"               -> 504
        case "CONNECTIVITY"          -> 503
        case "SERVICE_UNAVAILABLE"   -> 503
        case "BAD_GATEWAY"           -> 502
        else                         -> 500
    }
