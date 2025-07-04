import { query } from '../lib/db.js';
import { SearchApiToolResultItem, ApiToolStatus, UtilityProvider, SearchApiToolResult } from '@agent-base/types';

/**
 * @file Execution Stats Service
 * @description Handles database interactions for retrieving enriched API tool information for a user using a single query.
 */

/**
 * Retrieves all API tools for a specific user, enriched with tool details and execution statistics,
 * using a single database query. The result is wrapped in a SearchApiToolResult object.
 * @param {string} userId The ID of the user.
 * @param {string} organizationId The ID of the organization.
 * @returns {Promise<SearchApiToolResult>} An object containing the list of tools and the total count.
 * @throws {Error} If retrieval or processing fails.
 */
export const getUserApiTools = async (userId: string, organizationId: string): Promise<SearchApiToolResult> => {
    const logPrefix = `[ExecutionStatsService GetUserApiTools SingleQuery User: ${userId} in organization: ${organizationId}]`;

    // Note: ApiToolStatus.DELETED is assumed to be the string 'deleted'.
    // For robustness, it would be better to pass ApiToolStatus.DELETED as a second parameter ($2)
    // if the query function supports it easily, or ensure it's correctly escaped if directly interpolated.
    // However, given the existing pattern in databaseService.getUserApiToolsByUserId ($1, ApiToolStatus.DELETED),
    // and to keep this SQL self-contained for now, we'll use its string value.
    const deletedStatus = ApiToolStatus.DELETED; // 'deleted'

    const sql = `
        SELECT
            uat.user_id AS "userId",
            uat.api_tool_id AS "apiToolId",
            uat.status AS "status",
            uat.created_at AS "userToolCreatedAt",
            uat.updated_at AS "userToolUpdatedAt",
            atd.name AS "name",
            atd.description AS "description",
            atd.utility_provider AS "utilityProvider",
            atd.security_option AS "securityOption",
            atd.is_verified AS "isVerified",
            atd.creator_user_id AS "creatorUserId",
            COALESCE(stats.total_executions, 0) AS "totalExecutions",
            COALESCE(stats.succeeded_executions, 0) AS "succeededExecutions",
            COALESCE(stats.failed_executions, 0) AS "failedExecutions"
        FROM
            user_api_tools uat
        INNER JOIN
            api_tools atd ON uat.api_tool_id = atd.id
        LEFT JOIN (
            SELECT
                api_tool_id,
                user_id,
                COUNT(*) AS total_executions,
                SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS succeeded_executions,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed_executions
            FROM
                api_tool_executions
            GROUP BY
                api_tool_id, user_id
        ) stats ON uat.api_tool_id = stats.api_tool_id AND uat.user_id = stats.user_id
        WHERE
            uat.user_id = $1
            AND uat.organization_id = $2
            AND uat.status != $3;  -- Use $3 for the deleted status parameter
    `; // Note: $2 is organizationId, $3 is deletedStatus

    try {
        const result = await query(sql, [userId, organizationId, deletedStatus]);

        const items: SearchApiToolResultItem[] = result.rows.map((row: any) => {
            return {
                apiToolId: row.apiToolId,
                name: row.name,
                description: row.description,
                utilityProvider: row.utilityProvider as UtilityProvider, // Ensure this matches UtilityProvider enum values
                securityOption: row.securityOption,
                isVerified: row.isVerified,
                creatorUserId: row.creatorUserId, // Can be null/undefined from DB
                creatorOrganizationId: row.creatorOrganizationId, // Can be null/undefined from DB
                userId: row.userId,
                status: row.status as ApiToolStatus, // Ensure this matches ApiToolStatus enum values
                totalExecutions: parseInt(String(row.totalExecutions), 10),
                succeededExecutions: parseInt(String(row.succeededExecutions), 10),
                failedExecutions: parseInt(String(row.failedExecutions), 10),
                createdAt: new Date(row.userToolCreatedAt), // User-tool link creation date
                updatedAt: new Date(row.userToolUpdatedAt), // User-tool link update date
            };
        });
        
        // Wrap the items and total count in the SearchApiToolResult structure
        return {
            items: items,
            total: items.length,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`${logPrefix} Error fetching user API tools with single query: ${errorMessage}`, error);
        throw new Error(`Could not retrieve API tools for user ${userId}: ${errorMessage}`);
    }
}; 
