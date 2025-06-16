/// <reference types="node" />

import { query } from '../lib/db.js'; // Removed .js extension
import { mapRowToApiTool, mapRowToUserApiTool, mapRowToApiToolExecution } from '../types/db.types.js'; // Removed .js extension, Added ApiToolExecution and UserApiTool
import { ApiTool, ApiToolData, ApiToolExecution, ApiToolExecutionData, ApiToolStatus, UserApiTool } from '@agent-base/types'; // Import ApiToolStatus directly
import { Pool, QueryResult } from 'pg'; // Example: using pg

export interface ApiToolRecordInput extends ApiToolData {
    embedding?: number[];
}

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
    toolData: ApiToolData,
    embedding: number[]
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
        // @ts-ignore - creatorOrganizationId is in the ApiTool type
        creatorOrganizationId,
    } = toolData;

    const sql = `
        INSERT INTO api_tools (
            name, description, utility_provider, openapi_specification, security_option,
            security_secrets, is_verified, creator_user_id, creator_organization_id, embedding
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
            creatorOrganizationId,
            embedding,
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




/**
 * Records a single API tool execution event into the database.
 * @param {Omit<ApiToolExecutionData, 'id' | 'created_at' | 'updated_at'>} executionData - Data for the execution.
 * @returns {Promise<ApiToolExecution>} The created execution record.
 */
export const recordApiToolExecution = async (
    executionData: ApiToolExecutionData
): Promise<ApiToolExecution> => {
    const { apiToolId, userId, organizationId, input, output, statusCode, error, errorDetails, hint } = executionData;
    const sql = `
        INSERT INTO api_tool_executions (api_tool_id, user_id, organization_id, input, output, status_code, error, error_details, hint)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
            organizationId,
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
        return mapRowToApiToolExecution(result.rows[0]); // Using helper
    } catch (dbError) {
        console.error('[DB SERVICE] Error in recordApiToolExecution:', dbError);
        throw new Error(`Database error while recording API tool execution: ${(dbError as Error).message}`);
    }
};

/**
 * Retrieves all API tool execution records for a specific user.
 * @param {string} userId - The ID of the user whose executions are to be retrieved.
 * @returns {Promise<ApiToolExecution[]>} A list of execution records.
 */
export const getToolExecutionsByUserId = async (userId: string, organizationId: string): Promise<ApiToolExecution[]> => {
    const sql = `
        SELECT * FROM api_tool_executions
        WHERE user_id = $1 AND organization_id = $2
        ORDER BY created_at DESC;
    `;
    try {
        const result = await query(sql, [userId, organizationId]); // Using generic query
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
export const getOrCreateUserApiTool = async (userId: string, organizationId: string, apiToolId: string): Promise<UserApiTool> => {
    const findSql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND organization_id = $2 AND api_tool_id = $3;';
    try {
        const findResult = await query(findSql, [userId, organizationId, apiToolId]);
        if (findResult.rows.length > 0) {
            return mapRowToUserApiTool(findResult.rows[0]);
        } else {
            // Not found, create a new one. 'created_at' and 'updated_at' will use DB defaults.
            const insertSql = `
                INSERT INTO user_api_tools (user_id, organization_id, api_tool_id, status)
                VALUES ($1, $2, $3, $4)
                RETURNING *;
            `;
            // Use ApiToolStatus.UNSET which is 'unset'
            const insertResult = await query(insertSql, [userId, organizationId, apiToolId, ApiToolStatus.UNSET]);
            if (insertResult.rows.length === 0) {
                throw new Error('Failed to create UserApiToolRecord, no record returned.');
            }
            return mapRowToUserApiTool(insertResult.rows[0]);
        }
    } catch (error) {
        console.error(`Error in getOrCreateUserApiTool for user ${userId}, organization ${organizationId}, tool ${apiToolId}:`, error);
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
export const updateUserApiToolStatus = async (userId: string, organizationId: string, apiToolId: string, status: ApiToolStatus): Promise<UserApiTool | null> => {
    const sql = `
        UPDATE user_api_tools
        SET status = $1, updated_at = current_timestamp
        WHERE user_id = $2 AND organization_id = $3 AND api_tool_id = $4
        RETURNING *;
    `;
    try {
        const result = await query(sql, [status, userId, organizationId, apiToolId]);
        if (result.rows.length === 0) {
            // It's possible the record doesn't exist, which might not be an error in all cases.
            // Depending on requirements, you might want to throw or log here.
            console.warn(`No UserApiToolRecord found for user ${userId} in organization ${organizationId} and tool ${apiToolId} to update status.`);
            return null;
        }
        return mapRowToUserApiTool(result.rows[0]);
    } catch (error) {
        console.error(`Error updating UserApiToolRecord status for user ${userId} in organization ${organizationId}, tool ${apiToolId}:`, error);
        throw new Error('Could not update UserApiToolRecord status.');
    }
};

/**
 * Retrieves all UserApiToolRecord for a given user ID, excluding those with DELETED status.
 * @param {string} userId The ID of the user.
 * @returns {Promise<UserApiToolRecord[]>} An array of UserApiToolRecord.
 * @throws {Error} If the database operation fails.
 */
export const getUserApiToolsByUserId = async (userId: string, organizationId: string): Promise<UserApiTool[]> => {
    const sql = 'SELECT * FROM user_api_tools WHERE user_id = $1 AND organization_id = $2 AND status != $3 ORDER BY created_at DESC;';
    try {
        const result = await query(sql, [userId, organizationId, ApiToolStatus.DELETED]);
        return result.rows.map(mapRowToUserApiTool);
    } catch (error) {
        console.error(`Error fetching user API tools for user ID ${userId} in organization ${organizationId}:`, error);
        throw new Error('Could not retrieve user API tools.');
    }
}; 