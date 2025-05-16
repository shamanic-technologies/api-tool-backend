import { Buffer } from 'buffer'; // Added for Base64 encoding

import {
    ApiToolExecutionResponse,
    ApiTool, // Keep for external signatures if needed, but internal will use ApiToolRecord
    AgentServiceCredentials,
    ApiToolInfo,
    UserType,
    SetupNeeded,
    UtilityInputSecret,
    UtilityProvider, // Ensure this is imported if used directly
    ApiToolStatus,
    SuccessResponse // Added SuccessResponse import
} from '@agent-base/types';
import { JSONSchema7 } from 'json-schema';
// Import updated database service functions and types
import {
    createApiTool,
    getApiToolById,
    getAllApiTools,
    // updateApiTool, // Add if/when an update utility function is needed
    // deleteApiTool, // Add if/when a delete utility function is needed
    recordApiToolExecution,
    getOrCreateUserApiTool,
    updateUserApiToolStatus,
    getUserApiToolsByUserId, // Added import
} from './databaseService';
import { ApiToolRecord, ApiToolExecutionRecord, UserApiToolRecord } from '../types/db.types'; // Added UserApiToolRecord import
import { handleExecution } from './executionService';
import { getOperation, deriveSchemaFromOperation, getCredentialKeyForScheme, getBasicAuthCredentialKeys } from './utils';
import { gsmClient } from '..';
import { generateSecretManagerId } from '@agent-base/secret-client';

/**
 * @file Utility Service
 * @description Handles business logic for API tools, including listing, details, creation, and execution orchestration.
 * Uses databaseService for data persistence.
 */

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

// Helper to map ApiToolRecord to ApiTool (if needed for strict type adherence to external contracts)
// For many cases, ApiToolRecord might be directly usable where ApiTool was, due to structural similarity.
const mapApiToolRecordToApiTool = (record: ApiToolRecord): ApiTool => {
    return {
        id: record.id,
        utilityProvider: record.utility_provider,
        openapiSpecification: record.openapi_specification,
        securityOption: record.security_option,
        securitySecrets: record.security_secrets,
        isVerified: record.is_verified,
        creatorUserId: record.creator_user_id,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
    };
};

/**
 * Service function to list available API tools (summary: ID, name, description).
 * @returns {Promise<ApiToolList>} A list of API tool summaries.
 */
export const listAvailableTools = async (): Promise<ApiToolList> => {
    const toolRecords = await getAllApiTools();
    return toolRecords.map(tool => ({
        id: tool.id,
        name: tool.openapi_specification.info.title,
        description: tool.openapi_specification.info.description || '',
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
    const tool = await getApiToolById(toolId); // Fetches ApiToolRecord | null
    if (!tool) return null;

    const operation = getOperation(tool.openapi_specification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract operation to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: tool.openapi_specification.info.title,
            description: tool.openapi_specification.info.description || '',
            utilityProvider: tool.utility_provider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed due to invalid operation in OpenAPI spec' } as JSONSchema7,
        };
    }

    const derivedSchema = deriveSchemaFromOperation(operation, tool.openapi_specification, logPrefix);
    if (!derivedSchema) {
        console.error(`${logPrefix} Failed to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: tool.openapi_specification.info.title,
            description: tool.openapi_specification.info.description || '',
            utilityProvider: tool.utility_provider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed' } as JSONSchema7,
        };
    }

    const toolInfo: ApiToolInfo = {
        id: tool.id,
        name: tool.openapi_specification.info.title,
        description: tool.openapi_specification.info.description || '',
        utilityProvider: tool.utility_provider, // ApiToolRecord has utility_provider
        schema: derivedSchema,
    };
    return toolInfo;
};

/**
 * Data required to create a new API tool. 
 * Based on ApiToolData but ensures required fields for DB are present.
 */
export interface CreateApiToolData {
    utilityProvider: UtilityProvider;
    openapiSpecification: ApiToolRecord['openapi_specification']; // Use the exact type from ApiToolRecord
    securityOption: string;
    securitySecrets: ApiToolRecord['security_secrets']; // Use the exact type from ApiToolRecord
    isVerified?: boolean; // DB has default false
    creatorUserId: string; // Required for creation
}

/**
 * Service function to add a new API tool configuration.
 * @param {CreateApiToolData} toolCreationData - The data for the new API tool.
 * @returns {Promise<ApiTool>} The added API tool, mapped from ApiToolRecord.
 * @throws {Error} If creation fails.
 */
export const addNewTool = async (toolCreationData: CreateApiToolData): Promise<ApiTool> => {
    // ID is auto-generated by DB. We don't check for existing ID before creation.
    // Uniqueness constraints (e.g., on tool name for a user) should be handled by DB schema if needed.
    
    const toolDataForDb: Omit<ApiToolRecord, 'id' | 'created_at' | 'updated_at'> = {
        utility_provider: toolCreationData.utilityProvider,
        openapi_specification: toolCreationData.openapiSpecification,
        security_option: toolCreationData.securityOption,
        security_secrets: toolCreationData.securitySecrets,
        is_verified: toolCreationData.isVerified === undefined ? false : toolCreationData.isVerified, // Default to false if not provided
        creator_user_id: toolCreationData.creatorUserId,
    };

    try {
        const createdToolRecord = await createApiTool(toolDataForDb);
        return mapApiToolRecordToApiTool(createdToolRecord); // Map to ApiTool for the return type
    } catch (error) {
        console.error('Error in addNewTool service:', error);
        // Rethrow or handle as specific error type if preferred
        if (error instanceof Error) {
            throw new Error(`Failed to add new tool: ${error.message}`);
        }
        throw new Error('Failed to add new tool due to an unknown error.');
    }
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
        // Ensure user-tool record exists, creating it with UNSET status if it's the first call.
        try {
            await getOrCreateUserApiTool(clientUserId, toolId);
            console.log(`${logPrefix} Ensured UserApiTool record exists for user ${clientUserId}, tool ${toolId}.`);
        } catch (dbError) {
            // Log the error but don't let it block the main execution flow.
            // The primary function is to execute the tool. Status tracking is secondary.
            console.error(`${logPrefix} Failed to get or create UserApiTool record, continuing execution:`, dbError);
        }

        const apiToolRecord = await getApiToolById(toolId); 

        if (!apiToolRecord) {
            return { success: false, error: `Tool config not found for ID '${toolId}'.` };
        }

        // The rest of the logic uses fields available on apiToolRecord 
        // (e.g., apiToolRecord.security_option, apiToolRecord.openapi_specification)
        // So, direct usage of apiToolRecord should be fine here.

        const resolvedSecrets: Record<string, string> = {};
        const missingSecretsDetails: Array<{ secretKeyInSpec: string, secretType: UtilityInputSecret, inputPrompt: string }> = [];

        if (apiToolRecord.security_option && apiToolRecord.openapi_specification.components?.securitySchemes) {
            const securityScheme = apiToolRecord.openapi_specification.components.securitySchemes[apiToolRecord.security_option];
            
            if (securityScheme && !('$ref' in securityScheme)) {
                if (securityScheme.type === 'apiKey') {
                    const apiKeyNameInSpec = securityScheme.name; 
                    const apiKeySchemeName = apiToolRecord.security_option; 
                    const apiKeyType = apiToolRecord.security_secrets?.['x-secret-name'];
                    
                    const effectiveApiKeyNameForLog = apiKeyNameInSpec || 'api_key_name_missing_in_spec';

                    if (!apiKeyType) {
                        console.error(`${logPrefix} Misconfig: apiKey '${apiKeySchemeName}' for ${apiToolRecord.id} lacks 'x-secret-name' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyNameForLog, secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: `Enter API Key for ${effectiveApiKeyNameForLog}` });
                    } else {
                        console.log(`${logPrefix} Fetching UserID: '${clientUserId}', Provider: '${apiToolRecord.utility_provider}', Type: '${apiKeyType}' (for apiKey scheme '${apiKeySchemeName}')`);
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiToolRecord.utility_provider.toString(), apiKeyType);
                        console.log(`${logPrefix} Attempting to fetch GSM secret for API Key '${apiKeySchemeName}' with ID: ${gsmSecretId}`);
                        try {
                            const secretValue = await gsmClient.getSecret(gsmSecretId);
                            console.log(`${logPrefix} GSM response for '${gsmSecretId}': ${secretValue === null ? 'null' : secretValue === undefined ? 'undefined' : (secretValue === '' ? 'empty string' : 'received value')}`);
                            if (secretValue) {
                                const credKey = getCredentialKeyForScheme(apiKeySchemeName);
                                resolvedSecrets[credKey] = secretValue;
                                console.log(`${logPrefix} Stored raw API key for scheme '${apiKeySchemeName}' under key '${credKey}'.`);
                            } else {
                                missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyNameForLog, secretType: apiKeyType as UtilityInputSecret, inputPrompt: `Enter API Key for ${effectiveApiKeyNameForLog}` });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyNameForLog, secretType: apiKeyType as UtilityInputSecret, inputPrompt: `Enter API Key for ${effectiveApiKeyNameForLog}` }); 
                        }
                    }
                } else if (securityScheme.type === 'http' && securityScheme.scheme === 'bearer') {
                    const bearerSchemeName = apiToolRecord.security_option;
                    const bearerTokenType = apiToolRecord.security_secrets?.['x-secret-name']; 
                    if (!bearerTokenType) {
                        console.error(`${logPrefix} Misconfig: Bearer token scheme '${bearerSchemeName}' for ${apiToolRecord.id} lacks 'x-secret-name' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: bearerSchemeName, secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: 'Enter Bearer Token' });
                    } else {
                        console.log(`${logPrefix} Fetching UserID: '${clientUserId}', Provider: '${apiToolRecord.utility_provider}', Type: '${bearerTokenType}' (for bearer scheme '${bearerSchemeName}')`);
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiToolRecord.utility_provider.toString(), bearerTokenType);
                        console.log(`${logPrefix} Attempting to fetch GSM secret for Bearer scheme '${bearerSchemeName}' with ID: ${gsmSecretId}`);
                        try {
                            const tokenValue = await gsmClient.getSecret(gsmSecretId);
                            console.log(`${logPrefix} GSM response for '${gsmSecretId}': ${tokenValue === null ? 'null' : tokenValue === undefined ? 'undefined' : (tokenValue === '' ? 'empty string' : 'received value')}`);
                            if (tokenValue) {
                                const credKey = getCredentialKeyForScheme(bearerSchemeName);
                                resolvedSecrets[credKey] = tokenValue;
                                console.log(`${logPrefix} Stored raw Bearer token for scheme '${bearerSchemeName}' under key '${credKey}'.`);
                            } else {
                                missingSecretsDetails.push({ secretKeyInSpec: bearerSchemeName, secretType: bearerTokenType as UtilityInputSecret, inputPrompt: 'Enter Bearer Token' });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: bearerSchemeName, secretType: bearerTokenType as UtilityInputSecret, inputPrompt: 'Enter Bearer Token' });
                        }
                    }
                } else if (securityScheme.type === 'http' && securityScheme.scheme === 'basic') {
                    const usernameSecretType = apiToolRecord.security_secrets?.['x-secret-username'];
                    const passwordSecretType = apiToolRecord.security_secrets?.['x-secret-password'];
                    let usernameValue: string | null = null;
                    let passwordValue: string = ""; 

                    if (!usernameSecretType) {
                        console.error(`${logPrefix} Misconfig: Basic auth for ${apiToolRecord.id} lacks 'x-secret-username' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: UtilityInputSecret.USERNAME, inputPrompt: 'Enter Username' });
                    } else {
                        const gsmUsernameSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiToolRecord.utility_provider.toString(), usernameSecretType);
                        console.log(`${logPrefix} Attempting to fetch GSM secret for Basic Auth Username with ID: ${gsmUsernameSecretId}`);
                        try {
                            usernameValue = await gsmClient.getSecret(gsmUsernameSecretId);
                            console.log(`${logPrefix} GSM response for '${gsmUsernameSecretId}' (username): ${usernameValue === null ? 'null' : usernameValue === undefined ? 'undefined' : (usernameValue === '' ? 'empty string' : 'received value')}`);
                            if (!usernameValue) {
                                missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' });
                            }
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' }); 
                        }
                    }

                    if (passwordSecretType) {
                        const gsmPasswordSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiToolRecord.utility_provider.toString(), passwordSecretType);
                        console.log(`${logPrefix} Attempting to fetch GSM secret for Basic Auth Password with ID: ${gsmPasswordSecretId}`);
                        try {
                            passwordValue = (await gsmClient.getSecret(gsmPasswordSecretId)) || "";
                            console.log(`${logPrefix} GSM response for '${gsmPasswordSecretId}' (password): ${passwordValue === null ? 'null' : passwordValue === undefined ? 'undefined' : (passwordValue === '' ? 'empty string' : 'received value (or empty if originally empty)')}`);
                        } catch (e) { 
                            missingSecretsDetails.push({ secretKeyInSpec: 'password', secretType: passwordSecretType as UtilityInputSecret, inputPrompt: 'Enter Password' });
                        }
                    }
                    
                    const basicAuthSecretsMissing = missingSecretsDetails.some(s => 
                        (s.secretKeyInSpec === 'username' && s.secretType === (usernameSecretType as UtilityInputSecret)) || 
                        (s.secretKeyInSpec === 'password' && s.secretType === (passwordSecretType as UtilityInputSecret))
                    );

                    if (usernameValue && !basicAuthSecretsMissing) {
                        const basicAuthKeys = getBasicAuthCredentialKeys(apiToolRecord.security_option);
                        resolvedSecrets[basicAuthKeys.username] = usernameValue;
                        resolvedSecrets[basicAuthKeys.password] = passwordValue;
                        console.log(`${logPrefix} Stored raw username and password for Basic Auth scheme '${apiToolRecord.security_option}' under keys '${basicAuthKeys.username}', '${basicAuthKeys.password}'.`);
                    } else if (!usernameValue && usernameSecretType && !basicAuthSecretsMissing) {
                        if (!missingSecretsDetails.some(s => s.secretKeyInSpec === 'username' && s.secretType === (usernameSecretType as UtilityInputSecret))){
                             missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: usernameSecretType as UtilityInputSecret, inputPrompt: 'Enter Username' });
                        }
                    }
                } 
            } else if (securityScheme && '$ref' in securityScheme) {
                console.warn(`${logPrefix} Security scheme '${apiToolRecord.security_option}' for ${apiToolRecord.id} is a $ref. Not processed.`);
            }
        }

        if (missingSecretsDetails.length > 0) {
            const uniqueMissingDetails = missingSecretsDetails.filter((detail, index, self) => 
                index === self.findIndex(d => d.secretKeyInSpec === detail.secretKeyInSpec && d.secretType === detail.secretType)
            );
            const requiredStandardSecrets = uniqueMissingDetails.map(d => d.secretType);

            const setupNeededData: SetupNeeded = {
                needsSetup: true, utilityProvider: apiToolRecord.utility_provider,
                title: `Config Required: ${apiToolRecord.openapi_specification.info.title}`,
                description: `To use '${apiToolRecord.openapi_specification.info.title}', provide: ${uniqueMissingDetails.map(d=>d.inputPrompt).join(', ')}. Securely stored.`,
                message: `Setup for ${apiToolRecord.openapi_specification.info.title}.`,
                requiredSecretInputs: requiredStandardSecrets,
                requiredActionConfirmations: [], 
            };

            const executionOutcomeForDb: Omit<ApiToolExecutionRecord, 'id' | 'created_at' | 'updated_at'> = {
                api_tool_id: apiToolRecord.id,
                user_id: agentServiceCredentials.clientUserId,
                input: params, 
                output: { success: true, data: setupNeededData }, 
                status_code: 200, 
                error: 'Prerequisites not met, setup needed.',
                error_details: JSON.stringify(setupNeededData),
                hint: setupNeededData.description, 
            };

            try {
                await recordApiToolExecution(executionOutcomeForDb);
            } catch (dbLogError) {
                console.error(`${logPrefix} FAILED to record SETUP NEEDED to DB from utilityService:`, dbLogError);
            }

            return { success: true, data: setupNeededData };
        }

        console.log(`${logPrefix} All required secrets found for ${apiToolRecord.id}. Delegating to handleExecution...`);
        const result = await handleExecution(agentServiceCredentials, apiToolRecord as unknown as ApiTool, conversationId, params, resolvedSecrets);

        // After successful execution (not an error, not a setup needed response)
        if (result.success === true) {
            // Check if result.data is not SetupNeeded
            const successData = (result as SuccessResponse<any>).data;
            if (!(typeof successData === 'object' && successData !== null && 'needsSetup' in successData && successData.needsSetup === true)) {
                try {
                    await updateUserApiToolStatus(clientUserId, toolId, ApiToolStatus.ACTIVE);
                    console.log(`${logPrefix} Updated UserApiTool status to ACTIVE for user ${clientUserId}, tool ${toolId}.`);
                } catch (dbUpdateError) {
                    // Log error but don't let it fail the overall successful execution response.
                    console.error(`${logPrefix} Failed to update UserApiTool status to ACTIVE, but tool execution was successful:`, dbUpdateError);
                }
            }
        }
        
        return result;

    } catch (error) {
        console.error(`${logPrefix} Error in runToolExecution for ${toolId}:`, error);
        // Record an execution attempt with an error if appropriate, or handle as needed.
        // This part might need more nuanced error handling for UserApiTool status if specific errors should prevent ACTIVE status.
        return { success: false, error: 'Tool execution orchestration failed.', details: error instanceof Error ? error.message : String(error) };
    }
};

/**
 * Service function to retrieve all API tools for a specific user, excluding deleted ones.
 * @param {string} userId The ID of the user.
 * @returns {Promise<UserApiToolRecord[]>} A list of user API tool records.
 * @throws {Error} If retrieval fails.
 */
export const getUserApiTools = async (userId: string): Promise<UserApiToolRecord[]> => {
    const logPrefix = `[UtilityService GetUserApiTools User: ${userId}]`;
    console.log(`${logPrefix} Retrieving tools for user.`);
    try {
        const userToolRecords = await getUserApiToolsByUserId(userId);
        return userToolRecords;
    } catch (error) {
        console.error(`${logPrefix} Error retrieving user API tools:`, error);
        if (error instanceof Error) {
            throw new Error(`Failed to retrieve API tools for user ${userId}: ${error.message}`);
        }
        throw new Error(`Failed to retrieve API tools for user ${userId} due to an unknown error.`);
    }
};
