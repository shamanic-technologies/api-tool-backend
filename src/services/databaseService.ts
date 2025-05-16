import { query } from '../lib/db'; // Removed .js extension
import { ApiToolRecord } from '../types/db.types'; // Removed .js extension

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
    toolData: Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'>
): Promise<ApiToolRecord> => {
    const {
        utility_provider,
        openapi_specification,
        security_option,
        security_secrets,
        is_verified,
        creator_user_id,
    } = toolData;

    const sql = `
        INSERT INTO api_tools (
            utility_provider, openapi_specification, security_option,
            security_secrets, is_verified, creator_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
    `;
    try {
        const params = [
            utility_provider,
            JSON.stringify(openapi_specification), // OpenAPIObject should be stringified for JSONB
            security_option,
            JSON.stringify(security_secrets),      // security_secrets should be stringified for JSONB
            is_verified,
            creator_user_id,
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
 * Records an API tool execution.
 * @param {Omit<ApiToolExecution, 'id' | 'created_at' | 'updated_at'>} executionData
 * @returns {Promise<ApiToolExecution>}
 */
// export const recordApiToolExecution = async (executionData) => { /* ... */ };

/**
 * Retrieves executions for a specific API tool.
 * @param {string} apiToolId
 * @returns {Promise<ApiToolExecution[]>}
 */
// export const getApiToolExecutions = async (apiToolId) => { /* ... */ }; 