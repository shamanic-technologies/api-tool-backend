import {
    ApiTool,
    ApiToolExecutionResponse,
    SuccessResponse,
    ErrorResponse,
    AgentServiceCredentials,
} from '@agent-base/types';
import axios from 'axios';

// Import functions from the new services
import { validateInputParameters } from './validationService';
import { checkPrerequisites } from './prerequisiteService';
import { makeApiCall } from './apiCallService';

/**
 * Handles the full execution flow for a given API tool.
 * Orchestrates validation, prerequisite checks, and API calls by delegating to other services.
 * @param {AgentServiceCredentials} agentServiceCredentials - Credentials for the agent service.
 * @param {ApiTool} apiTool - The API tool configuration.
 * @param {string} conversationId - The ID of the current conversation.
 * @param {Record<string, any>} params - The raw input parameters for the tool.
 * @returns {Promise<ApiToolExecutionResponse>} The result of the execution (Success, Error, or SetupNeeded).
 */
export const handleExecution = async (
    agentServiceCredentials: AgentServiceCredentials,
    apiTool: ApiTool,
    conversationId: string,
    params: Record<string, any>,
): Promise<ApiToolExecutionResponse> => {
    const logPrefix = `[EXECUTE ${apiTool.id}] User: ${agentServiceCredentials.clientUserId}`;
    try {
        // 1. Validate Input Parameters (using validationService)
        const validationResult = validateInputParameters(apiTool, params, logPrefix);
        if ('success' in validationResult && !validationResult.success) {
            console.log(`${logPrefix} Validation failed. Returning error response: ${JSON.stringify(validationResult,null,2)}`);
            return validationResult; // Return ErrorResponse directly
        }
        // Type assertion is safe because we checked for error case above
        const validatedParams = (validationResult as { validatedParams: Record<string, any> }).validatedParams;

        // 2. Check Prerequisites (using prerequisiteService)
        const prereqResult = await checkPrerequisites(apiTool, agentServiceCredentials);
        if (!prereqResult.prerequisitesMet) {
            // Non-null assertion is safe here due to prerequisitesMet check
            // Ensure setupNeededResponse is part of ApiToolExecutionResponse union
            return prereqResult.setupNeededResponse! as ApiToolExecutionResponse;
        }
        // Type assertion needed as credentials might be undefined if prerequisitesMet is false
        const credentials = prereqResult.credentials!;

        // 3. Execute API Call (using apiCallService)
        console.log(`${logPrefix} Prerequisites met. Proceeding with API call.`);
        const apiResult = await makeApiCall(apiTool, validatedParams, credentials, logPrefix);

        // 4. Format and Return Success Response
        // Ensure the structure matches SuccessResponse<unknown> from ApiToolExecutionResponse
        const successResponse: SuccessResponse<unknown> = {
            success: true,
            data: apiResult
        };
        return successResponse;

    } catch (error) {
        // This catch block now primarily handles errors from prerequisite/API call services
        // or unexpected orchestration errors.
        console.error(`${logPrefix} Error during execution handling:`, error);
        // Format error into ErrorResponse
        let errorResponse: ErrorResponse;
        // Keep Axios error check for detailed API error reporting, 
        // though makeApiCall might abstract this away.
        if (axios.isAxiosError(error)) {
             const status = error.response?.status || 500;
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
            // Errors thrown by checkPrerequisites or makeApiCall directly
            errorResponse = {
                success: false,
                error: `Tool Execution Failed: ${error.message}`,
                details: error.stack
            };
        } else {
            // Unknown errors
             errorResponse = {
                success: false,
                error: 'An unknown error occurred during tool execution orchestration.'
             };
        }
        console.log(`${logPrefix} Returning error response from handleExecution:`, errorResponse);
        return errorResponse;
    }
}; 