import { query } from '../lib/db'; // Removed .js extension
import { ApiToolRecord, ApiToolExecutionRecord, UserApiToolRecord } from '../types/db.types'; // Removed .js extension, Added ApiToolExecution and UserApiTool
import { ApiTool, ApiToolData, ApiToolExecution, ApiToolExecutionData, ApiToolStatus, UserApiTool } from '@agent-base/types'; // Import ApiToolStatus directly
import { Pool, QueryResult } from 'pg'; // Example: using pg

/**
 * @file Database Service
 * @description Handles all database interactions for API tools, user API tools, and executions.
 * Replaces the previous JSON file-based mock database.
 */

// Helper function to map database row to ApiToolRecord (handles potential snake_case to camelCase if any)
// For now, field names in db.types.ts mostly match, but this is good practice.
const mapRowToApiTool = (row: any): ApiTool => {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        utilityProvider: row.utility_provider,
        openapiSpecification: row.openapi_specification,
        securityOption: row.security_option,
        securitySecrets: row.security_secrets,
        isVerified: row.is_verified,
        creatorUserId: row.creator_user_id,
        embedding: row.embedding,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
};

/**
 * Helper function to map a database row to an ApiToolExecution object.
 * Handles parsing of JSON string fields (input, output) and Date conversions.
 * @param {any} row - The database row.
 * @returns {ApiToolExecutionRecord} The mapped ApiToolExecution object.
 */
const mapRowToApiToolExecution = (row: any): ApiToolExecution => {
    let parsedInput = row.input;
    if (typeof row.input === 'string') {
        try {
            parsedInput = JSON.parse(row.input);
        } catch (e) {
            console.warn('Failed to parse input JSON string from DB:', e);
            // Keep as string if parsing fails, or handle as an error
        }
    }

    let parsedOutput = row.output;
    if (typeof row.output === 'string') {
        try {
            parsedOutput = JSON.parse(row.output);
        } catch (e) {
            console.warn('Failed to parse output JSON string from DB:', e);
             // Keep as string if parsing fails, or handle as an error
        }
    }

    return {
        id: row.id,
        apiToolId: row.api_tool_id,
        userId: row.user_id,
        input: parsedInput,
        output: parsedOutput,
        statusCode: row.status_code,
        error: row.error,
        errorDetails: row.error_details,
        hint: row.hint,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
};

// Corrected helper function to map database row to UserApiToolRecord
const mapRowToUserApiTool = (row: any): UserApiTool => {
    return {
        userId: row.user_id,
        apiToolId: row.api_tool_id,
        status: row.status as ApiToolStatus, // Ensure this matches the enum values, e.g., 'unset', 'active'
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
};

// Configure your database connection pool
// This is an example and should be configured according to your setup
const pool = new Pool({
  // connectionString: process.env.DATABASE_URL, // Recommended
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432"),
});

/**
 * Creates a new API tool record in the database.
 * @param {Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'>} toolData - The data for the new API tool.
 * @returns {Promise<ApiToolRecord>} The created API tool record.
 * @throws {Error} If the database operation fails.
 */
export const createApiTool = async (
    toolData: ApiToolData
): Promise<ApiTool> => {
    const {
        name,
        description,
        utilityProvider,
        openapiSpecification,
        securityOption,
        securitySecrets,
        isVerified,
        creatorUserId,
        embedding,
    } = toolData;

    const sql = `
        INSERT INTO api_tools (
            name, description, utility_provider, openapi_specification, security_option,
            security_secrets, is_verified, creator_user_id, embedding
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
    `;
    try {
        const params = [
            name,
            description,
            utilityProvider,
            JSON.stringify(openapiSpecification),
            securityOption,
            JSON.stringify(securitySecrets),
            isVerified,
            creatorUserId,
            embedding ? embedding : null,
        ];
        const result = await query(sql, params);
        if (result.rows.length === 0) {
            throw new Error('Failed to create API tool, no record returned.');
        }
        return mapRowToApiTool(result.rows[0]);
    } catch (error) {
        console.error("Error creating API tool in database:", error);
        throw new Error('Could not create API tool.');
    }
};

/**
 * Retrieves an API tool record by its ID.
 * @param {string} id - The UUID of the API tool.
 * @returns {Promise<ApiToolRecord | null>} The API tool record or null if not found.
 * @throws {Error} If the database operation fails.
 */
export const getApiToolById = async (id: string): Promise<ApiTool | null> => {
    const sql = 'SELECT * FROM api_tools WHERE id = $1;';
    try {
        const result = await query(sql, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return mapRowToApiTool(result.rows[0]);
    } catch (error) {
        console.error(`Error fetching API tool with ID ${id}:`, error);
        throw new Error('Could not retrieve API tool.');
    }
};

/**
 * Retrieves all API tool records from the database.
 * @returns {Promise<ApiToolRecord[]>} An array of API tool records.
 * @throws {Error} If the database operation fails.
 */
export const getAllApiTools = async (): Promise<ApiTool[]> => {
    const sql = 'SELECT * FROM api_tools ORDER BY created_at DESC;';
    try {
        const result = await query(sql);
        return result.rows.map(mapRowToApiTool);
    } catch (error) {
        console.error("Error fetching all API tools:", error);
        throw new Error('Could not retrieve API tools.');
    }
};

/**
 * Updates an existing API tool record by its ID.
 * @param {string} id - The UUID of the API tool to update.
 * @param {Partial<Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'>>} updates - An object containing the fields to update.
 * @returns {Promise<ApiToolRecord | null>} The updated API tool record or null if not found.
 * @throws {Error} If the database operation fails.
 */
export const updateApiTool = async (
    id: string,
    updates: Partial<ApiToolData>
): Promise<ApiTool | null> => {
    const updateFields = Object.keys(updates) as Array<keyof Partial<ApiToolData>>;
    if (updateFields.length === 0) {
        console.warn(`Update called for API tool ${id} with no update fields.`);
        return getApiToolById(id); 
    }

    const setClauses = updateFields.map((field, index) => {
        const columnName = field;
        if (field === 'openapiSpecification' || field === 'securitySecrets') {
            return `"${columnName}" = $${index + 1}::jsonb`;
        }
        return `"${columnName}" = $${index + 1}`;
    }).join(', ');

    const params = updateFields.map(field => {
        const value = updates[field];
        if (field === 'openapiSpecification' || field === 'securitySecrets') {
            return JSON.stringify(value);
        }
        return value;
    });
    
    params.push(id); // Add the ID for the WHERE clause

    const sql = `
        UPDATE api_tools
        SET ${setClauses}, updated_at = current_timestamp
        WHERE id = $${params.length}
        RETURNING *;
    `;

    try {
        const result = await query(sql, params);
        if (result.rows.length === 0) {
            return null; 
        }
        return mapRowToApiTool(result.rows[0]);
    } catch (error) {
        console.error(`Error updating API tool with ID ${id}:`, error);
        throw new Error('Could not update API tool.');
    }
};


/**
 * Deletes an API tool record by its ID.
 * @param {string} id - The UUID of the API tool to delete.
 * @returns {Promise<boolean>} True if the deletion was successful, false otherwise.
 * @throws {Error} If the database operation fails.
 */
export const deleteApiTool = async (id: string): Promise<boolean> => {
    const sql = 'DELETE FROM api_tools WHERE id = $1;';
    try {
        const result = await query(sql, [id]);
        return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
        console.error(`Error deleting API tool with ID ${id}:`, error);
        throw new Error('Could not delete API tool.');
    }
};

// --- Placeholder functions for UserApiTool ---
// TODO: Implement these based on requirements

/**
 * Associates a user with an API tool.
 * @param {string} userId
 * @param {string} apiToolId
 * @param {ApiToolStatus} status
 * @returns {Promise<UserApiTool>}
 */
// export const addUserApiTool = async (userId, apiToolId, status) => { /* ... */ };

/**
 * Retrieves API tools associated with a user.
 * @param {string} userId
 * @returns {Promise<UserApiTool[]>}
 */
// export const getUserApiTools = async (userId) => { /* ... */ };

// --- Placeholder functions for ApiToolExecution ---
// TODO: Implement these based on requirements

/**
 * Records a single API tool execution event into the database.
 * @param {Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at'>} executionData - Data for the execution.
 * @returns {Promise<ApiToolExecutionRecord>} The created execution record.
 */
export const recordApiToolExecution = async (
    executionData: ApiToolExecutionData
): Promise<ApiToolExecution> => {
    const { apiToolId, userId, input, output, statusCode, error, errorDetails, hint } = executionData;
    const sql = `
        INSERT INTO api_tool_executions (api_tool_id, user_id, input, output, status_code, error, error_details, hint)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
    `;
    // Ensure input and output are stringified if they are objects and your DB column is JSON/TEXT
    const safeInput = typeof input === 'object' ? JSON.stringify(input) : input;
    const safeOutput = typeof output === 'object' ? JSON.stringify(output) : output;
    const safeErrorDetails = typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails;

    try {
        const params = [
            apiToolId,
            userId,
            safeInput,
            safeOutput,
            statusCode,
            error,
            safeErrorDetails,
            hint,
        ];
        const result = await query(sql, params); // Using generic query
        if (result.rows.length === 0) {
            throw new Error('Failed to record API tool execution: No rows returned.');
        }
        console.log(`[DB SERVICE] Recorded execution for tool ${apiToolId} by user ${userId}`);
        return mapRowToApiToolExecution(result.rows[0]); // Using helper
    } catch (dbError) {
        console.error('[DB SERVICE] Error in recordApiToolExecution:', dbError);
        throw new Error(`Database error while recording API tool execution: ${(dbError as Error).message}`);
    }
};

/**
 * Retrieves all API tool execution records for a specific user.
 * @param {string} userId - The ID of the user whose executions are to be retrieved.
 * @returns {Promise<ApiToolExecutionRecord[]>} A list of execution records.
 */
export const getToolExecutionsByUserId = async (userId: string): Promise<ApiToolExecution[]> => {
    const sql = `
        SELECT * FROM api_tool_executions
        WHERE user_id = $1
        ORDER BY created_at DESC;
    `;
    try {
        const result = await query(sql, [userId]); // Using generic query
        console.log(`[DB SERVICE] Retrieved ${result.rows.length} executions for user ${userId}`);
        return result.rows.map(mapRowToApiToolExecution); // Using helper
    } catch (dbError) {
        console.error('[DB SERVICE] Error in getToolExecutionsByUserId:', dbError);
        throw new Error(`Database error while retrieving tool executions for user ${userId}: ${(dbError as Error).message}`);
    }
};

// --- User API Tool ---

/**
 * Finds an existing UserApiToolRecord by user ID and API tool ID, or creates a new one if not found.
 * If created, the status will be ApiToolStatus.UNSET.
 * @param {string} userId The ID of the user.
 * @param {string} apiToolId The ID of the API tool.
 * @returns {Promise<UserApiToolRecord>} The found or created UserApiToolRecord.
 * @throws {Error} If the database operation fails.
 */
export const getOrCreateUserApiTool = async (userId: string, apiToolId: string): Promise<UserApiTool> => {
    const findSql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND api_tool_id = $2;';
    try {
        const findResult = await query(findSql, [userId, apiToolId]);
        if (findResult.rows.length > 0) {
            return mapRowToUserApiTool(findResult.rows[0]);
        } else {
            // Not found, create a new one. 'created_at' and 'updated_at' will use DB defaults.
            const insertSql = `
                INSERT INTO user_api_tools (user_id, api_tool_id, status)
                VALUES ($1, $2, $3)
                RETURNING *;
            `;
            // Use ApiToolStatus.UNSET which is 'unset'
            const insertResult = await query(insertSql, [userId, apiToolId, ApiToolStatus.UNSET]);
            if (insertResult.rows.length === 0) {
                throw new Error('Failed to create UserApiToolRecord, no record returned.');
            }
            return mapRowToUserApiTool(insertResult.rows[0]);
        }
    } catch (error) {
        console.error(`Error in getOrCreateUserApiTool for user ${userId}, tool ${apiToolId}:`, error);
        throw new Error('Could not get or create UserApiToolRecord.');
    }
};

/**
 * Updates the status and updated_at timestamp of a UserApiToolRecord.
 * @param {string} userId The ID of the user.
 *   @param {string} apiToolId The ID of the API tool.
 * @param {ApiToolStatus} status The new status.
 * @returns {Promise<UserApiToolRecord | null>} The updated UserApiToolRecord, or null if not found.
 * @throws {Error} If the database operation fails.
 */
export const updateUserApiToolStatus = async (userId: string, apiToolId: string, status: ApiToolStatus): Promise<UserApiTool | null> => {
    const sql = `
        UPDATE user_api_tools
        SET status = $1, updated_at = current_timestamp
        WHERE user_id = $2 AND api_tool_id = $3
        RETURNING *;
    `;
    try {
        const result = await query(sql, [status, userId, apiToolId]);
        if (result.rows.length === 0) {
            // It's possible the record doesn't exist, which might not be an error in all cases.
            // Depending on requirements, you might want to throw or log here.
            console.warn(`No UserApiToolRecord found for user ${userId} and tool ${apiToolId} to update status.`);
            return null;
        }
        return mapRowToUserApiTool(result.rows[0]);
    } catch (error) {
        console.error(`Error updating UserApiToolRecord status for user ${userId}, tool ${apiToolId}:`, error);
        throw new Error('Could not update UserApiToolRecord status.');
    }
};

/**
 * Retrieves all UserApiToolRecord for a given user ID, excluding those with DELETED status.
 * @param {string} userId The ID of the user.
 * @returns {Promise<UserApiToolRecord[]>} An array of UserApiToolRecord.
 * @throws {Error} If the database operation fails.
 */
export const getUserApiToolsByUserId = async (userId: string): Promise<UserApiTool[]> => {
    const sql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND status != $2 ORDER BY created_at DESC;';
    try {
        const result = await query(sql, [userId, ApiToolStatus.DELETED]);
        return result.rows.map(mapRowToUserApiTool);
    } catch (error) {
        console.error(`Error fetching user API tools for user ID ${userId}:`, error);
        throw new Error('Could not retrieve user API tools.');
    }
}; 