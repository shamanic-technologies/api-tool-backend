import {
    ApiTool,
    ApiToolExecutionResponse,
    SuccessResponse,
    ErrorResponse,
    AgentServiceCredentials,
} from '@agent-base/types';
import axios from 'axios';
import { ApiToolExecutionRecord } from '../types/db.types';

// Import functions from the new services
import { validateInputParameters } from './validationService';
import { checkPrerequisites } from './prerequisiteService';
import { makeApiCall } from './apiCallService';
import { recordApiToolExecution } from './databaseService';

/**
 * Handles the full execution flow for a given API tool.
 * Orchestrates validation, prerequisite checks, and API calls by delegating to other services.
 * @param {AgentServiceCredentials} agentServiceCredentials - Credentials for the agent service.
 * @param {ApiTool} apiTool - The API tool configuration.
 * @param {string} conversationId - The ID of the current conversation.
 * @param {Record<string, any>} params - The raw input parameters for the tool.
 * @param {Record<string, string>} resolvedSecrets - The resolved secrets for the tool.
 * @returns {Promise<ApiToolExecutionResponse>} The result of the execution (Success, Error, or SetupNeeded).
 */
export const handleExecution = async (
    agentServiceCredentials: AgentServiceCredentials,
    apiTool: ApiTool,
    conversationId: string,
    params: Record<string, any>,
    resolvedSecrets: Record<string, string>
): Promise<ApiToolExecutionResponse> => {
    const logPrefix = `[EXECUTE ${apiTool.id}] User: ${agentServiceCredentials.clientUserId}`;
    let executionOutcome: Partial<Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at' | 'api_tool_id' | 'user_id'>> = {};
    let response: ApiToolExecutionResponse;

    try {
        // 1. Validate Input Parameters (using validationService)
        const validationResult = validateInputParameters(apiTool, params, logPrefix);
        if ('success' in validationResult && !validationResult.success) {
            console.log(`${logPrefix} Validation failed. Returning error response: ${JSON.stringify(validationResult,null,2)}`);
            executionOutcome = {
                input: params,
                output: validationResult,
                status_code: 400, // Or a more specific status code
                error: validationResult.error,
                error_details: JSON.stringify(validationResult.details)
            };
            response = validationResult;
            // Log and return immediately
            await recordApiToolExecution({
                api_tool_id: apiTool.id,
                user_id: agentServiceCredentials.clientUserId, // Using clientUserId
                input: executionOutcome.input,
                output: executionOutcome.output,
                status_code: executionOutcome.status_code!,
                error: executionOutcome.error,
                error_details: executionOutcome.error_details,
            });
            return response;
        }
        const validatedParams = (validationResult as { validatedParams: Record<string, any> }).validatedParams;
        executionOutcome.input = validatedParams; // Log validated params

        // 2. Check Prerequisites (using prerequisiteService)
        const prereqResult = await checkPrerequisites(apiTool, agentServiceCredentials, resolvedSecrets);
        if (!prereqResult.prerequisitesMet) {
            executionOutcome = {
                ...executionOutcome, // Keep previously set input
                output: prereqResult.setupNeededResponse,
                status_code: 424, // Failed Dependency / Setup Needed
                error: 'Prerequisites not met.',
                error_details: JSON.stringify(prereqResult.setupNeededResponse),
                hint: prereqResult.setupNeededResponse?.hint
            };
            // Non-null assertion is safe here due to prerequisitesMet check
            // Ensure setupNeededResponse is part of ApiToolExecutionResponse union
            response = prereqResult.setupNeededResponse! as ApiToolExecutionResponse;
            await recordApiToolExecution({
                api_tool_id: apiTool.id,
                user_id: agentServiceCredentials.clientUserId,
                input: executionOutcome.input,
                output: executionOutcome.output,
                status_code: executionOutcome.status_code!,
                error: executionOutcome.error,
                error_details: executionOutcome.error_details,
                hint: executionOutcome.hint,
            });
            return response;
        }
        const credentials = prereqResult.credentials!;

        // 3. Execute API Call (using apiCallService)
        console.log(`${logPrefix} Prerequisites met. Proceeding with API call.`);
        const apiResult = await makeApiCall(apiTool, validatedParams, credentials, logPrefix);

        // 4. Format and Return Success Response
        const successResponse: SuccessResponse<unknown> = {
            success: true,
            data: apiResult
        };
        executionOutcome = {
            ...executionOutcome,
            output: successResponse,
            status_code: 200, // Assuming 200 for success
        };
        response = successResponse;

    } catch (error) {
        console.error(`${logPrefix} Error during execution handling:`, error);
        let errorResponse: ErrorResponse;
        let statusCode = 500; // Default status code for errors

        if (axios.isAxiosError(error)) {
             const status = error.response?.status || 500;
             statusCode = status;
             const apiErrorData = error.response?.data;
             let errorMessage = error.message;
             let errorDetails = JSON.stringify(apiErrorData || {});

             if (typeof apiErrorData === 'object' && apiErrorData !== null && 'error' in apiErrorData) {
                if (typeof (apiErrorData as any).error === 'string') {
                    errorMessage = (apiErrorData as any).error;
                } else if (typeof (apiErrorData as any).error === 'object' && (apiErrorData as any).error !== null && 'message' in (apiErrorData as any).error) {
                    errorMessage = (apiErrorData as any).error.message;
                }
             } else if (typeof apiErrorData === 'string') {
                errorMessage = apiErrorData;
             }

             errorResponse = {
                success: false,
                error: `External API Error (${status}): ${errorMessage}`,
                details: errorDetails
             };
        } else if (error instanceof Error) {
            errorResponse = {
                success: false,
                error: `Tool Execution Failed: ${error.message}`,
                details: error.stack
            };
        } else {
             errorResponse = {
                success: false,
                error: 'An unknown error occurred during tool execution orchestration.'
             };
        }
        
        executionOutcome = {
            ...executionOutcome, // Keep input if it was set
            output: errorResponse,
            status_code: statusCode,
            error: errorResponse.error,
            error_details: JSON.stringify(errorResponse.details)
        };
        response = errorResponse;
        console.log(`${logPrefix} Returning error response from handleExecution:`, errorResponse);
    }

    // Common logging point for both success and caught errors
    try {
        await recordApiToolExecution({
            api_tool_id: apiTool.id,
            user_id: agentServiceCredentials.clientUserId,
            input: executionOutcome.input || params, // Fallback to raw params if validatedParams wasn't set (e.g. early error)
            output: executionOutcome.output,
            status_code: executionOutcome.status_code!,
            error: executionOutcome.error,
            error_details: executionOutcome.error_details,
            hint: executionOutcome.hint,
        });
    } catch (dbError) {
        // Log db errors but don't let them overshadow the original execution response
        console.error(`${logPrefix} Failed to record API tool execution to database:`, dbError);
    }

    return response;
}; 