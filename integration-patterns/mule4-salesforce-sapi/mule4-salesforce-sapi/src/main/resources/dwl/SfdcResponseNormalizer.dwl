%dw 2.0

/**
 * SfdcResponseNormalizer — Normalizes Salesforce responses into a consistent
 * API envelope. Handles single records, collections, nested relationships,
 * and bulk operation results.
 *
 * Every response from this SAPI follows this envelope:
 * {
 *   success: true,
 *   data: { ... },
 *   metadata: { operation, sObject, recordCount, timestamp, correlationId, apiVersion }
 * }
 */

/**
 * Wraps a Salesforce query result in the standard envelope.
 */
fun wrapQueryResponse(records, totalSize, done, nextRecordsUrl, correlationId: String, apiVersion: String) =
    {
        success: true,
        data: {
            records: records default [],
            totalSize: totalSize default sizeOf(records default []),
            done: done default true,
            (nextRecordsUrl: nextRecordsUrl) if (nextRecordsUrl != null)
        },
        metadata: {
            operation: "query",
            recordCount: sizeOf(records default []),
            hasMore: !(done default true),
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
            correlationId: correlationId,
            apiVersion: apiVersion
        }
    }

/**
 * Wraps a single-record CRUD response (create, update, delete, upsert).
 */
fun wrapCrudResponse(operation: String, sObjectType: String, result, correlationId: String, apiVersion: String) =
    {
        success: true,
        data: result,
        metadata: {
            operation: operation,
            sObject: sObjectType,
            recordCount: if (result is Array) sizeOf(result) else 1,
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
            correlationId: correlationId,
            apiVersion: apiVersion
        }
    }

/**
 * Wraps a bulk operation result.
 */
fun wrapBulkResponse(operation: String, sObjectType: String, jobId, state, numberRecordsProcessed, numberRecordsFailed, correlationId: String, apiVersion: String) =
    {
        success: (numberRecordsFailed default 0) == 0,
        data: {
            jobId: jobId,
            state: state,
            numberRecordsProcessed: numberRecordsProcessed default 0,
            numberRecordsFailed: numberRecordsFailed default 0
        },
        metadata: {
            operation: "bulk_" ++ operation,
            sObject: sObjectType,
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
            correlationId: correlationId,
            apiVersion: apiVersion
        }
    }

/**
 * Wraps a describe result (sObject metadata).
 */
fun wrapDescribeResponse(sObjectType: String, describeResult, correlationId: String, apiVersion: String) =
    {
        success: true,
        data: describeResult,
        metadata: {
            operation: "describe",
            sObject: sObjectType,
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
            correlationId: correlationId,
            apiVersion: apiVersion
        }
    }

/**
 * Wraps a search (SOSL) result.
 */
fun wrapSearchResponse(searchRecords, correlationId: String, apiVersion: String) =
    {
        success: true,
        data: {
            records: searchRecords default [],
            totalSize: sizeOf(searchRecords default [])
        },
        metadata: {
            operation: "search",
            recordCount: sizeOf(searchRecords default []),
            timestamp: now() as String {format: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"},
            correlationId: correlationId,
            apiVersion: apiVersion
        }
    }

/**
 * Strips Salesforce internal attributes from records for cleaner consumer output.
 * Removes 'type' and 'url' from the attributes sub-object that SF always returns.
 */
fun cleanSfdcRecord(record) =
    record mapObject ((value, key) ->
        if (key as String == "attributes") {}
        else {(key): value}
    )
