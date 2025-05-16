import { Buffer } from 'buffer'; // Added for Base64 encoding

import {
    ApiToolExecutionResponse, // Keep
    ApiTool,            // Keep
    AgentServiceCredentials,
    ApiToolInfo,        // Keep
    UserType, // Added: For secret ID generation
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
    const { clientUserId } = agentServiceCredentials; 
    const logPrefix = `[UtilityService RunTool ${toolId}] User: ${clientUserId}`;
    console.log(`${logPrefix} Orchestrating execution with params:`, JSON.stringify(params));

    try {
        const utilities = await readUtilities();
        const apiTool = utilities.find(t => t.id === toolId);

        if (!apiTool) {
            return { success: false, error: `Tool config not found for ID '${toolId}'.` };
        }

        const resolvedSecrets: Record<string, string> = {};
        const missingSecretsDetails: Array<{ secretKeyInSpec: string, secretType: UtilityInputSecret, inputPrompt: string }> = [];

        if (apiTool.securityOption && apiTool.openapiSpecification.components?.securitySchemes) {
            const securityScheme = apiTool.openapiSpecification.components.securitySchemes[apiTool.securityOption];
            
            if (securityScheme && !('$ref' in securityScheme)) {
                if (securityScheme.type === 'apiKey') {
                    const apiKeyNameInSpec = securityScheme.name; // Required by OpenAPI spec for apiKey
                    const apiKeyType = apiTool.securitySecrets?.['x-secret-name']; // This is a UtilityInputSecret string value
                    
                    // Ensure apiKeyNameInSpec is a valid string for indexing and details
                    const effectiveApiKeyName = apiKeyNameInSpec || 'api_key_name_missing_in_spec';

                    if (!apiKeyType) {
                        console.error(`${logPrefix} Misconfig: apiKey '${apiTool.securityOption}' for ${apiTool.id} lacks 'x-secret-name' in securitySecrets.`);
                        // Use a default UtilityInputSecret type if apiKeyType is missing
                        missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyName, secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: `Enter API Key for ${effectiveApiKeyName}` });
                    } else {
                        console.log(`${logPrefix} Fetching UserID: '${clientUserId}', Provider: '${apiTool.utilityProvider}', Type: '${apiKeyType}' (for apiKey ${effectiveApiKeyName})`);
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), apiKeyType);
                        try {
                            const secretValue = await gsmClient.getSecret(gsmSecretId);
                            if (secretValue) {
                                resolvedSecrets[effectiveApiKeyName] = secretValue;
                            } else {
                                missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyName, secretType: apiKeyType as UtilityInputSecret, inputPrompt: `Enter API Key for ${effectiveApiKeyName}` });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyName, secretType: apiKeyType as UtilityInputSecret, inputPrompt: `Enter API Key for ${effectiveApiKeyName}` }); 
                        }
                    }
                } else if (securityScheme.type === 'http' && securityScheme.scheme === 'bearer') {
                    const bearerTokenType = apiTool.securitySecrets?.['x-secret-name']; // This is a UtilityInputSecret string value
                    if (!bearerTokenType) {
                        console.error(`${logPrefix} Misconfig: Bearer token for ${apiTool.id} lacks 'x-secret-name' in securitySecrets.`);
                        // Default to API_SECRET_KEY if specific bearer type isn't configured properly, or use a dedicated one if available
                        missingSecretsDetails.push({ secretKeyInSpec: 'Authorization', secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: 'Enter Bearer Token' });
                    } else {
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), bearerTokenType);
                        try {
                            const tokenValue = await gsmClient.getSecret(gsmSecretId);
                            if (tokenValue) {
                                resolvedSecrets['Authorization'] = `Bearer ${tokenValue}`;
                            } else {
                                missingSecretsDetails.push({ secretKeyInSpec: 'Authorization', secretType: bearerTokenType as UtilityInputSecret, inputPrompt: 'Enter Bearer Token' });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: 'Authorization', secretType: bearerTokenType as UtilityInputSecret, inputPrompt: 'Enter Bearer Token' });
                        }
                    }
                } else if (securityScheme.type === 'http' && securityScheme.scheme === 'basic') {
                    const usernameSecretType = apiTool.securitySecrets?.['x-secret-username']; // UtilityInputSecret string value
                    const passwordSecretType = apiTool.securitySecrets?.['x-secret-password']; // UtilityInputSecret string value
                    let usernameValue: string | null = null;
                    let passwordValue: string = ""; 

                    if (!usernameSecretType) {
                        console.error(`${logPrefix} Misconfig: Basic auth for ${apiTool.id} lacks 'x-secret-username' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: UtilityInputSecret.USERNAME, inputPrompt: 'Enter Username' });
                    } else {
                        const gsmUsernameSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), usernameSecretType);
                        try {
                            usernameValue = await gsmClient.getSecret(gsmUsernameSecretId);
                            if (!usernameValue) {
                                missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' }); 
                        }
                    }

                    if (passwordSecretType) {
                        const gsmPasswordSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), passwordSecretType);
                        try {
                            passwordValue = (await gsmClient.getSecret(gsmPasswordSecretId)) || "";
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: 'password', secretType: passwordSecretType as UtilityInputSecret, inputPrompt: 'Enter Password' });
                        }
                    }
                    
                    const basicAuthSecretsMissing = missingSecretsDetails.some(s => 
                        (s.secretKeyInSpec === 'username' && s.secretType === (usernameSecretType as UtilityInputSecret)) || 
                        (s.secretKeyInSpec === 'password' && s.secretType === (passwordSecretType as UtilityInputSecret))
                    );

                    if (usernameValue && !basicAuthSecretsMissing) {
                        const basicToken = Buffer.from(`${usernameValue}:${passwordValue}`).toString('base64');
                        resolvedSecrets['Authorization'] = `Basic ${basicToken}`;
                    } else if (!usernameValue && usernameSecretType && !basicAuthSecretsMissing) {
                        if (!missingSecretsDetails.some(s => s.secretKeyInSpec === 'username' && s.secretType === (usernameSecretType as UtilityInputSecret))){
                             missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' });
                        }
                    }
                } 
            } else if (securityScheme && '$ref' in securityScheme) {
                console.warn(`${logPrefix} Security scheme '${apiTool.securityOption}' for ${apiTool.id} is a $ref. Not processed.`);
            }
        }

        if (missingSecretsDetails.length > 0) {
            const uniqueMissingDetails = missingSecretsDetails.filter((detail, index, self) => 
                index === self.findIndex(d => d.secretKeyInSpec === detail.secretKeyInSpec && d.secretType === detail.secretType)
            );
            const requiredStandardSecrets = uniqueMissingDetails.map(d => d.secretType);

            const setupNeededData: SetupNeeded = {
                needsSetup: true, utilityProvider: apiTool.utilityProvider,
                title: `Config Required: ${apiTool.openapiSpecification.info.title}`,
                description: `To use '${apiTool.openapiSpecification.info.title}', provide: ${uniqueMissingDetails.map(d=>d.inputPrompt).join(', ')}. Securely stored.`,
                message: `Setup for ${apiTool.openapiSpecification.info.title}.`,
                requiredSecretInputs: requiredStandardSecrets,
                requiredActionConfirmations: [], 
            };
            return { success: true, data: setupNeededData };
        }

        console.log(`${logPrefix} All required secrets found for ${apiTool.id}. Delegating to handleExecution...`);
        const result = await handleExecution(agentServiceCredentials, apiTool, conversationId, params, resolvedSecrets);
        return result;

    } catch (error) {
        console.error(`${logPrefix} Error in runToolExecution for ${toolId}:`, error); // Changed apiTool.id to toolId
        return { success: false, error: 'Tool execution orchestration failed.', details: error instanceof Error ? error.message : String(error) };
    }
};
