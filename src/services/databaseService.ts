import { query } from '../lib/db'; // Removed .js extension
import { ApiToolRecord, ApiToolExecutionRecord, UserApiToolRecord } from '../types/db.types'; // Removed .js extension, Added ApiToolExecution and UserApiTool
import { ApiToolStatus } from '@agent-base/types'; // Import ApiToolStatus directly

/**
 * @file Database Service
 * @description Handles all database interactions for API tools, user API tools, and executions.
 * Replaces the previous JSON file-based mock database.
 */

// Helper function to map database row to ApiToolRecord (handles potential snake_case to camelCase if any)
// For now, field names in db.types.ts mostly match, but this is good practice.
const mapRowToApiToolRecord = (row: any): ApiToolRecord => {
    return {
        id: row.id,
        utility_provider: row.utility_provider,
        openapi_specification: row.openapi_specification,
        security_option: row.security_option,
        security_secrets: row.security_secrets,
        is_verified: row.is_verified,
        creator_user_id: row.creator_user_id,
        embedding: row.embedding,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
};

/**
 * Helper function to map a database row to an ApiToolExecution object.
 * Handles parsing of JSON string fields (input, output) and Date conversions.
 * @param {any} row - The database row.
 * @returns {ApiToolExecutionRecord} The mapped ApiToolExecution object.
 */
const mapRowToApiToolExecution = (row: any): ApiToolExecutionRecord => {
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
        api_tool_id: row.api_tool_id,
        user_id: row.user_id,
        input: parsedInput,
        output: parsedOutput,
        status_code: row.status_code,
        error: row.error,
        error_details: row.error_details,
        hint: row.hint,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
};

// Corrected helper function to map database row to UserApiToolRecord
const mapRowToUserApiToolRecord = (row: any): UserApiToolRecord => {
    return {
        user_id: row.user_id,
        api_tool_id: row.api_tool_id,
        status: row.status as ApiToolStatus, // Ensure this matches the enum values, e.g., 'unset', 'active'
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
};

/**
 * Creates a new API tool record in the database.
 * @param {Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'>} toolData - The data for the new API tool.
 * @returns {Promise<ApiToolRecord>} The created API tool record.
 * @throws {Error} If the database operation fails.
 */
export const createApiTool = async (
    toolData: Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'> & { embedding?: number[] }
): Promise<ApiToolRecord> => {
    const {
        utility_provider,
        openapi_specification,
        security_option,
        security_secrets,
        is_verified,
        creator_user_id,
        embedding,
    } = toolData;

    const sql = `
        INSERT INTO api_tools (
            utility_provider, openapi_specification, security_option,
            security_secrets, is_verified, creator_user_id, embedding
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
    `;
    try {
        const params = [
            utility_provider,
            JSON.stringify(openapi_specification),
            security_option,
            JSON.stringify(security_secrets),
            is_verified,
            creator_user_id,
            embedding ? embedding : null,
        ];
        const result = await query(sql, params);
        if (result.rows.length === 0) {
            throw new Error('Failed to create API tool, no record returned.');
        }
        return mapRowToApiToolRecord(result.rows[0]);
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
export const getApiToolById = async (id: string): Promise<ApiToolRecord | null> => {
    const sql = 'SELECT * FROM api_tools WHERE id = $1;';
    try {
        const result = await query(sql, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        return mapRowToApiToolRecord(result.rows[0]);
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
export const getAllApiTools = async (): Promise<ApiToolRecord[]> => {
    const sql = 'SELECT * FROM api_tools ORDER BY created_at DESC;';
    try {
        const result = await query(sql);
        return result.rows.map(mapRowToApiToolRecord);
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
    updates: Partial<Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'>>
): Promise<ApiToolRecord | null> => {
    const updateFields = Object.keys(updates) as Array<keyof typeof updates>;
    if (updateFields.length === 0) {
        console.warn(`Update called for API tool ${id} with no update fields.`);
        return getApiToolById(id); 
    }

    const setClauses = updateFields.map((field, index) => {
        // Ensure JSON fields are stringified if they are part of the update
        // Also, ensure column names are double-quoted if they might conflict with SQL keywords or contain special characters
        // (though our current names are safe, this is good practice).
        const columnName = field; // In our case, field names match column names directly from ApiToolRecord keys
        if (field === 'openapi_specification' || field === 'security_secrets') {
            return `"${columnName}" = $${index + 1}::jsonb`;
        }
        return `"${columnName}" = $${index + 1}`;
    }).join(', ');

    const params = updateFields.map(field => {
        const value = updates[field];
        if (field === 'openapi_specification' || field === 'security_secrets') {
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
        return mapRowToApiToolRecord(result.rows[0]);
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
 * Records an API tool execution in the database.
 * @param {Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at'>} executionData - The data for the execution.
 * @returns {Promise<ApiToolExecutionRecord>} The recorded API tool execution.
 * @throws {Error} If the database operation fails.
 */
export const recordApiToolExecution = async (
    executionData: Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at'>
): Promise<ApiToolExecutionRecord> => {
    const {
        api_tool_id,
        user_id,
        input,
        output,
        status_code,
        error,
        error_details,
        hint,
    } = executionData;

    const sql = `
        INSERT INTO api_tool_executions (
            api_tool_id, user_id, input, output,
            status_code, error, error_details, hint
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
    `;
    try {
        const params = [
            api_tool_id,
            user_id,
            JSON.stringify(input), // Assuming input is an object
            JSON.stringify(output), // Assuming output is an object
            status_code,
            error,
            error_details,
            hint,
        ];
        const result = await query(sql, params);
        if (result.rows.length === 0) {
            throw new Error('Failed to record API tool execution, no record returned.');
        }
        // Map row to ApiToolExecution, ensuring dates are handled correctly
        const row = result.rows[0];
        return mapRowToApiToolExecution(row);
    } catch (dbError) {
        console.error("Error recording API tool execution in database:", dbError);
        // It's good practice to throw a more specific error or the original one,
        // depending on how you want to handle it upstream.
        throw new Error('Could not record API tool execution.');
    }
};

/**
 * Retrieves executions for a specific API tool, optionally filtered by user ID.
 * @param {string} apiToolId - The UUID of the API tool.
 * @param {string} [userId] - Optional user ID to filter executions.
 * @returns {Promise<ApiToolExecutionRecord[]>} An array of API tool executions.
 * @throws {Error} If the database operation fails.
 */
export const getApiToolExecutions = async (apiToolId: string, userId?: string): Promise<ApiToolExecutionRecord[]> => {
    let sql = 'SELECT * FROM api_tool_executions WHERE api_tool_id = $1';
    const params: any[] = [apiToolId];

    if (userId) {
        sql += ' AND user_id = $2';
        params.push(userId);
    }
    sql += ' ORDER BY created_at DESC;';

    try {
        const result = await query(sql, params);
        return result.rows.map(mapRowToApiToolExecution);
    } catch (error) {
        console.error(`Error fetching executions for API tool ${apiToolId}:`, error);
        throw new Error('Could not retrieve API tool executions.');
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
export const getOrCreateUserApiTool = async (userId: string, apiToolId: string): Promise<UserApiToolRecord> => {
    const findSql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND api_tool_id = $2;';
    try {
        const findResult = await query(findSql, [userId, apiToolId]);
        if (findResult.rows.length > 0) {
            return mapRowToUserApiToolRecord(findResult.rows[0]);
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
            return mapRowToUserApiToolRecord(insertResult.rows[0]);
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
export const updateUserApiToolStatus = async (userId: string, apiToolId: string, status: ApiToolStatus): Promise<UserApiToolRecord | null> => {
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
        return mapRowToUserApiToolRecord(result.rows[0]);
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
export const getUserApiToolsByUserId = async (userId: string): Promise<UserApiToolRecord[]> => {
    const sql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND status != $2 ORDER BY created_at DESC;';
    try {
        const result = await query(sql, [userId, ApiToolStatus.DELETED]);
        return result.rows.map(mapRowToUserApiToolRecord);
    } catch (error) {
        console.error(`Error fetching user API tools for user ID ${userId}:`, error);
        throw new Error('Could not retrieve user API tools.');
    }
}; 