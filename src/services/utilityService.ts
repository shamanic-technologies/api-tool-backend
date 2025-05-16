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
    InternalUtilityInfo,
    UserType, // Added: For secret ID generation
    UtilitySecretType, // Added: For secret ID generation and typing
    SetupNeeded,        // Added: For constructing compliant response
    UtilityInputSecret  // Added: For mapping and typing
} from '@agent-base/types';
import { JSONSchema7 } from 'json-schema'; // For ApiToolInfo schema
// Import database service functions
import { readUtilities, writeUtilities } from './databaseService';
// Remove client imports (handled by executionService)
// import { fetchSecrets } from '../clients/secretServiceClient';
// import { checkAuth, CheckAuthResultData } from '../clients/toolAuthServiceClient';
// Import the new execution handler
import { handleExecution } from './executionService';
import { getOperation, deriveSchemaFromOperation } from './utils'; // For deriving schema for ApiToolInfo
import { gsmClient } from '..'; // Changed from ../index.js
import { generateSecretManagerId } from '@agent-base/secret-client'; // Added import for shared utility

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
 * Loads the tool configuration, checks for required secrets, and then delegates execution.
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
    const { clientUserId } = agentServiceCredentials; // platformUserId might also be relevant for secret scoping
    const logPrefix = `[UtilityService RunTool ${toolId}] User: ${clientUserId}`;
    console.log(`${logPrefix} Orchestrating execution with params:`, JSON.stringify(params));

    try {
        const utilities = await readUtilities();
        const apiTool = utilities.find(t => t.id === toolId);

        if (!apiTool) {
            console.error(`${logPrefix} Error: Tool config not found for ID '${toolId}'.`);
            return {
                success: false,
                error: `Tool configuration with ID '${toolId}' not found.`
            };
        }

        const resolvedSecrets: Record<string, string> = {};
        const missingSecretsDetails: Array<{
            secretKeyInSpec: string; // e.g. name of the security scheme, or 'ApiKeyAuth'
            secretType: UtilitySecretType; // e.g. 'api_key', 'username', 'password'
            description?: string; // From security scheme
            inputPrompt: string; // e.g. "Enter your Google API Key"
        }> = [];

        if (apiTool.securityOption && apiTool.openapiSpecification.components?.securitySchemes) {
            const securityScheme = apiTool.openapiSpecification.components.securitySchemes[apiTool.securityOption];
            
            // Check if securityScheme is a ReferenceObject. If so, we cannot directly access its properties.
            // For simplicity, we'll skip referenced security schemes for now. A full implementation would resolve them.
            if (securityScheme && !('$ref' in securityScheme)) {
                if (securityScheme.type) { // Ensure securityScheme and its type exist
                    // Standardized lookup for the "actual" secret type/name expected by the tool
                    // This comes from apiTool.securitySecrets which maps semantic roles (like 'x-secret-name')
                    // to the specific UtilitySecretType for that role in this tool.
                    
                    let requiredSecretKeysInSpec: Array<{ specKey: string, type: UtilitySecretType, prompt: string, openApiName?: string}> = [];

                    if (securityScheme.type === 'apiKey' && apiTool.securitySecrets?.['x-secret-name']) {
                        // 'name' from OpenAPI (e.g., 'X-API-KEY') is the header/query param name.
                        // The 'x-secret-name' in apiTool.securitySecrets gives us the *type* of secret.
                        requiredSecretKeysInSpec.push({
                            specKey: apiTool.securityOption, // The name of the security scheme itself
                            type: apiTool.securitySecrets['x-secret-name'],
                            prompt: `Enter the API Key for ${apiTool.openapiSpecification.info.title} (parameter: ${securityScheme.name})`,
                            openApiName: securityScheme.name // e.g. 'X-API-KEY'
                        });
                    } else if (securityScheme.type === 'http') {
                        if (securityScheme.scheme === 'bearer' && apiTool.securitySecrets?.['x-secret-name']) {
                             requiredSecretKeysInSpec.push({
                                specKey: apiTool.securityOption, // e.g. 'BearerAuth'
                                type: apiTool.securitySecrets['x-secret-name'], // Should be 'bearer_token' or similar
                                prompt: `Enter the Bearer Token for ${apiTool.openapiSpecification.info.title}`,
                                openApiName: 'Authorization' // Standard header name
                            });
                        } else if (securityScheme.scheme === 'basic') {
                            if (apiTool.securitySecrets?.['x-secret-username']) {
                                requiredSecretKeysInSpec.push({
                                    specKey: 'username', // logical key
                                    type: apiTool.securitySecrets['x-secret-username'], // Should be 'username'
                                    prompt: `Enter the Username for ${apiTool.openapiSpecification.info.title} (Basic Auth)`,
                                    openApiName: 'Authorization' // Basic auth also uses Authorization header
                                });
                            }
                            if (apiTool.securitySecrets?.['x-secret-password']) {
                                 requiredSecretKeysInSpec.push({
                                    specKey: 'password', // logical key
                                    type: apiTool.securitySecrets['x-secret-password'], // Should be 'password'
                                    prompt: `Enter the Password for ${apiTool.openapiSpecification.info.title} (Basic Auth)`,
                                    openApiName: 'Authorization'
                                });
                            }
                        }
                    }
                    // TODO: Add support for OAuth2 if needed, which is more complex (tokens, refresh tokens)

                    for (const { specKey, type, prompt, openApiName } of requiredSecretKeysInSpec) {
                        // The 'type' (e.g., 'api_key_google', 'stripe_test_key') is what we registered in securitySecrets.
                        // This 'type' should be used for GSM ID generation.
                        console.log(`${logPrefix} Preparing to fetch secret. UserID: '${clientUserId}', Provider: '${apiTool.utilityProvider.toString()}', SecretType: '${type}'`);
                        const gsmSecretId = generateSecretManagerId( // Use the imported shared utility
                            UserType.Client,                    // userType
                            clientUserId,                       // userId
                            apiTool.utilityProvider.toString(), // utilityProvider
                            type,                               // secretType
                        );
                        console.log(`${logPrefix} Generated GSM Secret ID: '${gsmSecretId}'`);
                        try {
                            const secretValue = await gsmClient.getSecret(gsmSecretId);
                            console.log(`${logPrefix} Value from GSM for ID '${gsmSecretId}': ${secretValue ? `'${typeof secretValue === 'string' ? secretValue.substring(0,15) : JSON.stringify(secretValue)}...' (type: ${typeof secretValue})` : String(secretValue)}`);
                            if (secretValue) {
                                console.log(`${logPrefix} Successfully fetched secret for GSM ID: ${gsmSecretId}`);
                                // Store the secret by its role or openApiName so handleExecution knows what it is
                                resolvedSecrets[openApiName || specKey] = secretValue; 
                            } else {
                                console.warn(`${logPrefix} Secret not found in GSM for ID: ${gsmSecretId} (type: ${type}) (gsmClient.getSecret returned falsy)`);
                                missingSecretsDetails.push({
                                    secretKeyInSpec: specKey,
                                    secretType: type, // The specific type from securitySecrets
                                    description: securityScheme.description || `Required ${type} for ${apiTool.openapiSpecification.info.title}`,
                                    inputPrompt: prompt
                                });
                            }
                        } catch (error) {
                            console.error(`${logPrefix} Explicit error caught from gsmClient.getSecret for ID '${gsmSecretId}' (type: ${type}):`, error);
                            // Treat GSM error as secret not found for setup purposes
                             missingSecretsDetails.push({
                                secretKeyInSpec: specKey,
                                secretType: type,
                                description: securityScheme.description || `Required ${type} for ${apiTool.openapiSpecification.info.title} - Error during fetch.`,
                                inputPrompt: prompt
                            });
                        }
                    }
                } // end if (securityScheme.type)
            } else if (securityScheme && '$ref' in securityScheme) {
                console.warn(`${logPrefix} Security scheme '${apiTool.securityOption}' is a ReferenceObject ($ref) and will not be processed for direct secret fetching in this version.`);
                // Optionally, you could treat this as needing setup if you expect direct definitions.
                // For now, we proceed as if no secrets were defined by this $ref, but a full implementation would resolve it.
            }
        }

        if (missingSecretsDetails.length > 0) {
            console.log(`${logPrefix} Tool requires setup due to missing secrets:`, missingSecretsDetails.map(s => s.secretType));

            // 1. Map custom secret types to standard UtilityInputSecret enum values
            const requiredStandardSecrets: UtilityInputSecret[] = missingSecretsDetails.map(detail => {
                // Attempt to directly use 'detail.secretType' if it's already a valid UtilityInputSecret value.
                // This assumes 'detail.secretType' (derived from apiTool.securitySecrets) 
                // might already be one of the standard enum string values.
                if (Object.values(UtilityInputSecret).includes(detail.secretType as UtilityInputSecret)) {
                    return detail.secretType as UtilityInputSecret;
                }
                
                // ***** CRUCIAL MAPPING LOGIC REQUIRED HERE IF detail.secretType IS NOT A STANDARD UtilityInputSecret VALUE *****
                // Example:
                // if (detail.secretType === 'custom_username_type_for_crisp') return UtilityInputSecret.USERNAME;
                // if (detail.secretType === 'custom_api_key_for_crisp') return UtilityInputSecret.API_SECRET_KEY;

                console.warn(`${logPrefix} No direct mapping or specific rule found for secretType: "${detail.secretType}". This secret might not appear correctly in the setup form or might be skipped if not a valid UtilityInputSecret.`);
                // Depending on strictness, you might return null and filter, or attempt a generic mapping if possible.
                // For now, we pass it through, relying on the frontend to handle unrecognized types gracefully or for 'detail.secretType' to be valid.
                // A more robust solution would ensure 'detail.secretType' from 'apiTool.securitySecrets' IS ALWAYS a UtilityInputSecret string.
                return detail.secretType as UtilityInputSecret; // Cast, hoping it's a valid value or will be handled
            }).filter(s => s !== null && s !== undefined); // Filter out any nulls if mapping logic could produce them


            // 2. Construct the compliant SetupNeeded object
            const setupNeededData: SetupNeeded = {
                needsSetup: true,
                utilityProvider: apiTool.utilityProvider,
                // 3. Add title, description, message
                title: `Configuration Required: ${apiTool.openapiSpecification.info.title}`,
                description: `To use '${apiTool.openapiSpecification.info.title}', please provide the following information. Your data will be stored securely.`,
                message: `Additional setup is needed for the tool: ${apiTool.openapiSpecification.info.title}.`,
                requiredSecretInputs: requiredStandardSecrets,
                // Ensure other optional fields from SetupNeeded are present if applicable
                requiredActionConfirmations: [], // Initialize as empty; add logic if actions are needed
                // oauthUrl: undefined, // Initialize if not applicable here; add logic if OAuth is part of this flow
            };

            return {
                success: true, // The operation to check was successful, but setup is needed
                data: setupNeededData // Send the compliant object
            };
        }

        console.log(`${logPrefix} All required secrets found. Delegating to handleExecution...`);
        // Pass resolvedSecrets to handleExecution.
        const result = await handleExecution(agentServiceCredentials, apiTool, conversationId, params, resolvedSecrets);
        
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
