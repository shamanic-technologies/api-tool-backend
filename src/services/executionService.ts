import {
    ApiTool,
    SuccessResponse,
    ErrorResponse,
    AgentInternalCredentials,
    SetupNeeded,
    ApiToolExecutionResult,
    ServiceResponse,
} from '@agent-base/types';
import axios from 'axios';
import { ApiToolExecutionRecord } from '../types/db.types.js';

// Import functions from the new services
import { validateInputParameters } from './validationService.js';
import { checkPrerequisites } from './prerequisiteService.js';
import { makeApiCall } from './apiCallService.js';
import { recordApiToolExecution } from './databaseService.js';
import { getTableNameForApiTool } from '@agent-base/neon-client';

/**
 * Handles the full execution flow for a given API tool.
 * Orchestrates validation, prerequisite checks, and API calls by delegating to other services.
 * @param {AgentServiceCredentials} agentInternalCredentials - Credentials for the agent service.
 * @param {ApiTool} apiTool - The API tool configuration.
 * @param {string} conversationId - The ID of the current conversation.
 * @param {Record<string, any>} params - The raw input parameters for the tool.
 * @param {Record<string, string>} resolvedSecrets - The resolved secrets for the tool.
 * @param {string} logPrefix - A prefix for logging messages.
 * @returns {Promise<ApiToolExecutionResult>} The result of the execution (Success, Error, or SetupNeeded).
 */
export const handleExecution = async (
    agentInternalCredentials: AgentInternalCredentials,
    apiTool: ApiTool,
    conversationId: string,
    params: Record<string, any>,
    resolvedSecrets: Record<string, string>,
    logPrefix: string
): Promise<ServiceResponse<ApiToolExecutionResult>> => {
    let executionOutcome: Partial<Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at' | 'api_tool_id' | 'user_id'>> = {};
    let validationResponseData: Record<string, any> | undefined;

    try {
        // 1. Validate Input Parameters (using validationService)
        const validationResponse : ServiceResponse<Record<string, any>> = validateInputParameters(apiTool, params, logPrefix);
        if (!validationResponse.success) {
            console.log(`${logPrefix} Validation failed. Returning error response: ${JSON.stringify(validationResponse,null,2)}`);
            executionOutcome = {
                input: params,
                status_code: validationResponse.statusCode || 500, // Or a more specific status code
                error: validationResponse.error,
                error_details: JSON.stringify(validationResponse.details),
                hint: validationResponse.hint,
            };
            try {
                await recordApiToolExecution({
                    apiToolId: apiTool.id,
                    userId: agentInternalCredentials.clientUserId, 
                    organizationId: agentInternalCredentials.clientOrganizationId,
                    input: executionOutcome.input,
                    output: executionOutcome.output,
                    statusCode: executionOutcome.status_code || 500,
                    error: executionOutcome.error,
                    errorDetails: executionOutcome.error_details,
                });
            } catch (dbLogError) {
                console.error(`${logPrefix} FAILED to record VALIDATION FAILURE to DB:`, dbLogError);
            }
            return validationResponse;
        }
        validationResponseData = validationResponse.data;
        executionOutcome.input = validationResponseData; // Log validated params for subsequent logging attempts

        // 2. Check Prerequisites (using prerequisiteService)
        const prereqResult : { setupNeeded?: SetupNeeded; credentials?: Record<string, string | null> } = await checkPrerequisites(apiTool, agentInternalCredentials, resolvedSecrets);
        if (prereqResult.setupNeeded?.needsSetup) {
            const setupNeededData = prereqResult.setupNeeded; 
            const hintFromData = setupNeededData?.hint;

            executionOutcome = {
                ...executionOutcome, 
                output: setupNeededData, // This is the full SuccessResponse<SetupNeeded>
                status_code: 200, // SetupNeeded is a successful response indicating next steps
                hint: hintFromData // Use the hint extracted from setupResponse.data
            };
            validationResponseData = setupNeededData; // This is what gets sent to client
            
            try {
                await recordApiToolExecution({
                    apiToolId: apiTool.id,
                    userId: agentInternalCredentials.clientUserId,
                    organizationId: agentInternalCredentials.clientOrganizationId,
                    input: executionOutcome.input || params, 
                    output: executionOutcome.output,
                    statusCode: executionOutcome.status_code || 200, 
                    hint: executionOutcome.hint,
                });
            } catch (dbLogError) {
                console.error(`${logPrefix} FAILED to record PREREQUISITE FAILURE (Setup Needed) to DB:`, dbLogError);
            }
            return { success: true, data: validationResponseData };
        }
        const credentials = prereqResult.credentials;

        // 3. Execute API Call (using apiCallService)
        if (credentials) {
            console.log(`${logPrefix} Prerequisites met. Proceeding with API call.`);
            const apiCallResponse : ServiceResponse<ApiToolExecutionResult> = await makeApiCall(apiTool, validationResponseData, credentials, logPrefix);
            if (!apiCallResponse.success) {
                return apiCallResponse;
            }

            // 4. Format and Return Success Response
            executionOutcome = {
                ...executionOutcome,
                output: apiCallResponse,
                status_code: 200, // Assuming 200 for success
            };
            validationResponseData = apiCallResponse.data as Record<string, any>;

        } else {
            console.error(`${logPrefix} No validation response data to proceed with API call.`);
            return { success: false, error: 'No validation response data to proceed with API call.' };
        }

    } catch (error) {
        console.error(`${logPrefix} Error during execution handling:`, error);
        let errorResponse: ErrorResponse;
        let statusCode = 500; // Default status code for errors

        if (axios.isAxiosError(error)) {
             const status = error.response?.status || 500;
             statusCode = status;
            
             let errorData = error.response?.data;
            // The data from axios might be a buffer if responseType was arraybuffer
            if (errorData && Buffer.isBuffer(errorData)) {
                try {
                    const decoded = errorData.toString('utf-8');
                    errorData = JSON.parse(decoded);
                } catch (e) {
                    errorData = errorData.toString('utf-8');
                }
            }
             
             let errorMessage = error.message;
             let errorDetails = JSON.stringify(errorData || {});

             if (typeof errorData === 'object' && errorData !== null && 'error' in errorData) {
                if (typeof (errorData as any).error === 'string') {
                    errorMessage = (errorData as any).error;
                } else if (typeof (errorData as any).error === 'object' && (errorData as any).error !== null && 'message' in (errorData as any).error) {
                    errorMessage = (errorData as any).error.message;
                }
             } else if (typeof errorData === 'string') {
                errorMessage = errorData;
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
        validationResponseData = errorResponse;
        console.log(`${logPrefix} Returning error response from handleExecution:`, errorResponse);
    }

    // Common logging point for both success and caught errors
    try {
        await recordApiToolExecution({
            apiToolId: apiTool.id,
            userId: agentInternalCredentials.clientUserId,
            organizationId: agentInternalCredentials.clientOrganizationId,
            input: executionOutcome.input || params, // Fallback to raw params if validatedParams wasn't set
            output: executionOutcome.output,
            statusCode: executionOutcome.status_code || 500, // Should be set in success or catch block
            error: executionOutcome.error,
            errorDetails: executionOutcome.error_details,
            hint: executionOutcome.hint,
        });
    } catch (dbError) {
        console.error(`${logPrefix} FAILED to record FINAL execution outcome to database:`, dbError);
    }

    return {
        success: true, 
        data: validationResponseData as ApiToolExecutionResult,
     };
}; 