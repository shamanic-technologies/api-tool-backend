import fs from 'fs/promises';
import path from 'path';
// Remove unused imports
// import axios from 'axios';
// import Ajv, { ErrorObject } from 'ajv';
// const addFormats = require('ajv-formats'); 
import {
    ExternalUtilityExecutionResponse,
    // UtilitySecret, // No longer needed directly here
    // AuthMethod, // No longer needed directly here
    // ApiKeyAuthScheme, // No longer needed directly here
    ExternalUtilityTool,
    ExternalUtilityInfo,
    UtilitiesList,
    UtilitiesListItem,
    SuccessResponse,
    ErrorResponse,
    AgentServiceCredentials,
    // SetupNeededData // No longer needed directly here
} from '@agent-base/types';
// Import database service functions
import { readUtilities, writeUtilities } from './databaseService';
// Remove client imports (handled by executionService)
// import { fetchSecrets } from '../clients/secretServiceClient';
// import { checkAuth, CheckAuthResultData } from '../clients/toolAuthServiceClient';
// Import the new execution handler
import { handleExecution } from './executionService';

// Path to the mock database file - REMOVED

// Helper functions read/write utilities - REMOVED

// Initialize AJV - REMOVED (moved to executionService)

// Service function to list available tools (simplified: ID and description)
export const listAvailableTools = async (): Promise<UtilitiesList> => {
    const utilities = await readUtilities(); 
    return utilities.map(tool => ({ id: tool.id, description: tool.description }) as UtilitiesListItem);
};

// Service function to get tool details (ID, description, schema)
export const getToolDetails = async (toolId: string): Promise<ExternalUtilityInfo | null> => {
    const utilities = await readUtilities(); 
    const tool = utilities.find(t => t.id === toolId);
    if (!tool) return null;
    return tool as ExternalUtilityInfo;
};

// Service function to add a new tool configuration
export const addNewTool = async (newConfig: ExternalUtilityTool): Promise<ExternalUtilityTool> => {
    const utilities = await readUtilities(); 
    const existingTool = utilities.find(t => t.id === newConfig.id);
    if (existingTool) {
        throw new Error(`Tool with ID '${newConfig.id}' already exists.`);
    }
    // TODO: Consider moving config validation here or into a dedicated validation service
    utilities.push(newConfig);
    await writeUtilities(utilities);
    return newConfig;
};

// --- Tool Execution Logic ---

/**
 * Main service function to execute a tool.
 * Loads the tool configuration and delegates execution to executionService.
 */
export const runToolExecution = async (
    agentServiceCredentials: AgentServiceCredentials,
    toolId: string,
    conversationId: string,
    params: Record<string, any>
): Promise<ExternalUtilityExecutionResponse> => {
    const { clientUserId, platformUserId, platformApiKey, agentId } = agentServiceCredentials;
    const logPrefix = `[EXECUTE ${toolId}] User: ${clientUserId}`; 
    console.log(`${logPrefix} Orchestrating execution with params:`, params);

    try {
        // 1. Load Tool Configuration
        const utilities = await readUtilities();
        const utilityTool = utilities.find(t => t.id === toolId);
        if (!utilityTool) {
            console.error(`${logPrefix} Error: Tool config not found.`);
            // Return specific error if tool config itself is not found
            const errorResponse: ErrorResponse = {
                success: false,
                error: `Tool configuration with ID '${toolId}' not found.`
            };
            return errorResponse;
        }

        // 2. Delegate Execution to executionService
        console.log(`${logPrefix} Delegating to handleExecution...`);
        const result = await handleExecution(agentServiceCredentials, utilityTool, conversationId, params);
        
        // 3. Return the result from executionService
        console.log(`${logPrefix} Execution handled. Returning result.`);
        return result;

    } catch (error) {
        // Catch errors specifically from loading the config (readUtilities)
        // Errors from handleExecution should be formatted as ExternalUtilityExecutionResponse already.
        console.error(`${logPrefix} Error during config loading or unexpected error:`, error);
        const errorResponse: ErrorResponse = {
            success: false,
            error: 'Failed to load tool configuration or unexpected error occurred.',
            details: error instanceof Error ? error.message : String(error)
        };
        return errorResponse;
    }
};

// REMOVED: validateInputParameters function (moved)
// REMOVED: checkPrerequisites function (moved)
// REMOVED: makeApiCall function (moved) 