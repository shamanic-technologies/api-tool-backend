import fs from 'fs/promises';
import path from 'path';
// Remove unused imports
// import axios from 'axios';
// import Ajv, { ErrorObject } from 'ajv';
// const addFormats = require('ajv-formats'); 
import {
    // ExternalUtilityExecutionResponse, // Removed
    // ExternalUtilityTool, // Removed
    // ExternalUtilityInfo, // Removed
    // UtilitiesList,       // Removed
    // UtilitiesListItem,   // Removed
    ApiToolExecutionResponse, // Keep
    ApiTool,            // Keep
    SuccessResponse,
    ErrorResponse,
    AgentServiceCredentials,
    ApiToolInfo,        // Keep
    UtilityProvider,    
    InternalUtilityInfo 
} from '@agent-base/types';
import { JSONSchema7 } from 'json-schema'; // For ApiToolInfo schema
// Import database service functions
import { readUtilities, writeUtilities } from './databaseService';
// Remove client imports (handled by executionService)
// import { fetchSecrets } from '../clients/secretServiceClient';
// import { checkAuth, CheckAuthResultData } from '../clients/toolAuthServiceClient';
// Import the new execution handler
import { handleExecution } from './executionService';
import { getOperation } from './utils'; // For deriving schema for ApiToolInfo
import { deriveSchemaFromOperation } from './validationService'; // To derive schema for ApiToolInfo

// Path to the mock database file - REMOVED

// Helper functions read/write utilities - REMOVED

// Initialize AJV - REMOVED (moved to executionService)

/**
 * Represents a summary of an API tool for listing.
 */
export interface ApiToolListItem {
    id: string;
    name: string;
    description?: string;
}

/**
 * Represents a list of API tool summaries.
 */
export type ApiToolList = ApiToolListItem[];

/**
 * Service function to list available API tools (summary: ID, name, description).
 * @returns {Promise<ApiToolList>} A list of API tool summaries.
 */
export const listAvailableTools = async (): Promise<ApiToolList> => {
    const utilities = await readUtilities(); 
    return utilities.map(tool => ({
        id: tool.id,
        name: tool.openapiSpecification.info.title,
        description: tool.openapiSpecification.info.description || '' // Fallback for undefined
    }));
};

/**
 * Service function to get detailed information about a specific API tool.
 * This includes deriving the JSONSchema7 for its parameters from the OpenAPI spec.
 * @param {string} toolId The ID of the tool.
 * @returns {Promise<ApiToolInfo | null>} Detailed tool information or null if not found.
 */
export const getToolDetails = async (toolId: string): Promise<ApiToolInfo | null> => {
    const logPrefix = `[UtilityService GetToolDetails ${toolId}]`;
    const utilities = await readUtilities(); 
    const tool = utilities.find(t => t.id === toolId);
    if (!tool) return null;

    const operation = getOperation(tool.openapiSpecification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract operation to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: tool.openapiSpecification.info.title,
            description: tool.openapiSpecification.info.description || '',
            utilityProvider: tool.utilityProvider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed due to invalid operation in OpenAPI spec' } as JSONSchema7
        };
    }

    const derivedSchema = deriveSchemaFromOperation(operation, tool.openapiSpecification, logPrefix);
    if (!derivedSchema) {
        console.error(`${logPrefix} Failed to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: tool.openapiSpecification.info.title,
            description: tool.openapiSpecification.info.description || '',
            utilityProvider: tool.utilityProvider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed' } as JSONSchema7
        };
    }

    const toolInfo: ApiToolInfo = {
        id: tool.id,
        name: tool.openapiSpecification.info.title,
        description: tool.openapiSpecification.info.description || '',
        utilityProvider: tool.utilityProvider,
        schema: derivedSchema
    };
    return toolInfo;
};

/**
 * Service function to add a new API tool configuration.
 * @param {ApiTool} newApiTool The new API tool configuration.
 * @returns {Promise<ApiTool>} The added API tool configuration.
 * @throws {Error} If a tool with the same ID already exists.
 */
export const addNewTool = async (newApiTool: ApiTool): Promise<ApiTool> => {
    const utilities = await readUtilities(); 
    const existingTool = utilities.find(t => t.id === newApiTool.id);
    if (existingTool) {
        throw new Error(`Tool with ID '${newApiTool.id}' already exists.`);
    }
    utilities.push(newApiTool);
    await writeUtilities(utilities);
    return newApiTool;
};

// --- Tool Execution Logic ---

/**
 * Main service function to execute an API tool.
 * Loads the tool configuration and delegates execution to executionService.
 * @param {AgentServiceCredentials} agentServiceCredentials Credentials for the agent.
 * @param {string} toolId The ID of the tool to execute.
 * @param {string} conversationId The ID of the current conversation.
 * @param {Record<string, any>} params The input parameters for the tool.
 * @returns {Promise<ApiToolExecutionResponse>} The result of the tool execution.
 */
export const runToolExecution = async (
    agentServiceCredentials: AgentServiceCredentials,
    toolId: string,
    conversationId: string,
    params: Record<string, any>
): Promise<ApiToolExecutionResponse> => {
    const { clientUserId } = agentServiceCredentials;
    const logPrefix = `[UtilityService RunTool ${toolId}] User: ${clientUserId}`;
    console.log(`${logPrefix} Orchestrating execution with params:`, JSON.stringify(params));

    try {
        const utilities = await readUtilities(); // Returns ApiTool[]
        const apiTool = utilities.find(t => t.id === toolId);
        if (!apiTool) {
            console.error(`${logPrefix} Error: Tool config not found for ID '${toolId}'.`);
            const errorResponse: ErrorResponse = {
                success: false,
                error: `Tool configuration with ID '${toolId}' not found.`
            };
            return errorResponse;
        }

        console.log(`${logPrefix} Delegating to handleExecution...`);
        // handleExecution now expects ApiTool
        const result = await handleExecution(agentServiceCredentials, apiTool, conversationId, params);
        
        console.log(`${logPrefix} Execution handled. Returning result.`);
        return result;

    } catch (error) {
        console.error(`${logPrefix} Error during tool execution orchestration:`, error);
        const errorResponse: ErrorResponse = {
            success: false,
            error: 'Failed to execute tool due to an unexpected error in utilityService.',
            details: error instanceof Error ? error.message : String(error)
        };
        return errorResponse;
    }
};

// REMOVED: validateInputParameters function (moved)
// REMOVED: checkPrerequisites function (moved)
// REMOVED: makeApiCall function (moved) 