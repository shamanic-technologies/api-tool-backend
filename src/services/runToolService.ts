import { getBasicAuthCredentialKeys } from "./utils.js";
import { ApiToolExecutionData, ApiToolStatus, SetupNeeded, SuccessResponse, UserType } from "@agent-base/types";
import { ApiToolExecutionResponse, UtilityInputSecret, AgentServiceCredentials } from "@agent-base/types";
import { generateSecretManagerId } from "@agent-base/secret-client";
import { getApiToolById, getOrCreateUserApiTool, recordApiToolExecution, updateUserApiToolStatus } from "./databaseService.js";
import { gsmClient } from "../index.js";
import { getCredentialKeyForScheme } from "./utils.js";
import { handleExecution } from "./executionService.js";


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

        const apiTool = await getApiToolById(toolId); 

        if (!apiTool) {
            return { success: false, error: `Tool config not found for ID '${toolId}'.` };
        }

        // The rest of the logic uses fields available on apiToolRecord 
        // (e.g., apiToolRecord.security_option, apiToolRecord.openapi_specification)
        // So, direct usage of apiToolRecord should be fine here.

        const resolvedSecrets: Record<string, string> = {};
        const missingSecretsDetails: Array<{ secretKeyInSpec: string, secretType: UtilityInputSecret, inputPrompt: string }> = [];

        if (apiTool.securityOption && apiTool.openapiSpecification.components?.securitySchemes) {
            const securityScheme = apiTool.openapiSpecification.components.securitySchemes[apiTool.securityOption];
            
            if (securityScheme && !('$ref' in securityScheme)) {
                if (securityScheme.type === 'apiKey') {
                    const apiKeyNameInSpec = securityScheme.name; 
                    const apiKeySchemeName = apiTool.securityOption; 
                    const apiKeyType = apiTool.securitySecrets?.['x-secret-name'];
                    
                    const effectiveApiKeyNameForLog = apiKeyNameInSpec || 'api_key_name_missing_in_spec';

                    if (!apiKeyType) {
                        console.error(`${logPrefix} Misconfig: apiKey '${apiKeySchemeName}' for ${apiTool.id} lacks 'x-secret-name' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: effectiveApiKeyNameForLog, secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: `Enter API Key for ${effectiveApiKeyNameForLog}` });
                    } else {
                        console.log(`${logPrefix} Fetching UserID: '${clientUserId}', Provider: '${apiTool.utilityProvider}', Type: '${apiKeyType}' (for apiKey scheme '${apiKeySchemeName}')`);
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), apiKeyType);
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
                    const bearerSchemeName = apiTool.securityOption;
                    const bearerTokenType = apiTool.securitySecrets?.['x-secret-name']; 
                    if (!bearerTokenType) {
                        console.error(`${logPrefix} Misconfig: Bearer token scheme '${bearerSchemeName}' for ${apiTool.id} lacks 'x-secret-name' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: bearerSchemeName, secretType: UtilityInputSecret.API_SECRET_KEY, inputPrompt: 'Enter Bearer Token' });
                    } else {
                        console.log(`${logPrefix} Fetching UserID: '${clientUserId}', Provider: '${apiTool.utilityProvider}', Type: '${bearerTokenType}' (for bearer scheme '${bearerSchemeName}')`);
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), bearerTokenType);
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
                    const usernameSecretType = apiTool.securitySecrets?.['x-secret-username'];
                    const passwordSecretType = apiTool.securitySecrets?.['x-secret-password'];
                    let usernameValue: string | null = null;
                    let passwordValue: string = ""; 

                    if (!usernameSecretType) {
                        console.error(`${logPrefix} Misconfig: Basic auth for ${apiTool.id} lacks 'x-secret-username' in securitySecrets.`);
                        missingSecretsDetails.push({ secretKeyInSpec: 'username', secretType: UtilityInputSecret.USERNAME, inputPrompt: 'Enter Username' });
                    } else {
                        const gsmUsernameSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), usernameSecretType);
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
                        const gsmPasswordSecretId = generateSecretManagerId(UserType.Client, clientUserId, apiTool.utilityProvider.toString(), passwordSecretType);
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
                        const basicAuthKeys = getBasicAuthCredentialKeys(apiTool.securityOption);
                        resolvedSecrets[basicAuthKeys.username] = usernameValue;
                        resolvedSecrets[basicAuthKeys.password] = passwordValue;
                        console.log(`${logPrefix} Stored raw username and password for Basic Auth scheme '${apiTool.securityOption}' under keys '${basicAuthKeys.username}', '${basicAuthKeys.password}'.`);
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

            const executionOutcomeForDb: ApiToolExecutionData = {
                apiToolId: apiTool.id,
                userId: agentServiceCredentials.clientUserId,
                input: params, 
                output: { success: true, data: setupNeededData }, 
                statusCode: 200, 
                error: 'Prerequisites not met, setup needed.',
                errorDetails: JSON.stringify(setupNeededData),
                hint: setupNeededData.description, 
            };

            try {
                await recordApiToolExecution(executionOutcomeForDb);
            } catch (dbLogError) {
                console.error(`${logPrefix} FAILED to record SETUP NEEDED to DB from utilityService:`, dbLogError);
            }

            return { success: true, data: setupNeededData };
        }

        console.log(`${logPrefix} All required secrets found for ${apiTool.id}. Delegating to handleExecution...`);
        const result = await handleExecution(agentServiceCredentials, apiTool, conversationId, params, resolvedSecrets);

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

