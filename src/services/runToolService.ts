import { getBasicAuthCredentialKeys } from "./utils.js";
import { 
    ApiToolExecutionData, 
    ApiToolStatus, 
    SetupNeeded, 
    UserType, 
    UtilityInputSecret, 
    AgentInternalCredentials, 
    ServiceResponse, 
    // @ts-ignore - ApiToolExecutionResult is not recognised in the types package
    ApiToolExecutionResult,
    ApiTool
} from "@agent-base/types";
import { generateSecretManagerId } from "@agent-base/secret-client";
import { getApiToolById, getOrCreateUserApiTool, recordApiToolExecution, updateUserApiToolStatus } from "./databaseService.js";
import { gsmClient } from "../index.js";
import { getCredentialKeyForScheme } from "./utils.js";
import { handleExecution } from "./executionService.js";
import { handleOauthCheck } from './oauthService.js';
import { logApiToolExecution } from "@agent-base/neon-client";

/**
 * Main service function to execute an API tool.
 * Loads the tool configuration, checks for required secrets, and then delegates execution.
 * @param {AgentInternalCredentials} agentServiceCredentials Credentials for the agent.
 * @param {string} toolId The ID of the tool to execute.
 * @param {string} conversationId The ID of the current conversation.
 * @param {Record<string, any>} params The input parameters for the tool.
 * @returns {Promise<ApiToolExecutionResult>} The result of the tool execution.
 */
export const runToolExecution = async (
    agentServiceCredentials: AgentInternalCredentials,
    toolId: string,
    conversationId: string,
    params: Record<string, any>
): Promise<ServiceResponse<ApiToolExecutionResult>> => {
    const { clientUserId, clientOrganizationId } = agentServiceCredentials; 
    const logPrefix = `[UtilityService RunTool ${toolId}] User: ${clientUserId}`;

    try {
        // Ensure user-tool record exists, creating it with UNSET status if it's the first call.
        try {
            await getOrCreateUserApiTool(clientUserId, clientOrganizationId, toolId);
        } catch (dbError) {
            // Log the error but don't let it block the main execution flow.
            // The primary function is to execute the tool. Status tracking is secondary.
            console.error(`${logPrefix} Failed to get or create UserApiTool record, continuing execution:`, dbError);
        }

        const apiTool = await getApiToolById(toolId); 

        if (!apiTool) {
            console.error(`${logPrefix} Tool config not found for ID '${toolId}'.`);
            return { success: false, error: `Tool config not found for ID '${toolId}'.` };
        }

        // --- OAuth Check ---
        const oauthCheckResult = await handleOauthCheck(apiTool, agentServiceCredentials);
        if (!oauthCheckResult.success) {
            console.error(`${logPrefix} OAuth check failed for tool ${toolId}:`, oauthCheckResult.error);
            return oauthCheckResult;
        }

        // @ts-ignore - The data object will have either needsAuth or accessToken
        if (oauthCheckResult.data.needsAuth) {
            return { success: true, data: oauthCheckResult.data };
        }
        
        // @ts-ignore
        const accessToken = oauthCheckResult.data.accessToken;


        // The rest of the logic uses fields available on apiToolRecord 
        // (e.g., apiToolRecord.security_option, apiToolRecord.openapi_specification)
        // So, direct usage of apiToolRecord should be fine here.

        const resolvedSecrets: Record<string, string> = {};
        const missingSecretsDetails: Array<{ secretKeyInSpec: string, secretType: UtilityInputSecret, inputPrompt: string }> = [];

        if (accessToken) {
            resolvedSecrets[getCredentialKeyForScheme(apiTool.securityOption)] = accessToken;
        }

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
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, clientOrganizationId, apiTool.utilityProvider.toString(), apiKeyType);
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
                        const gsmSecretId = generateSecretManagerId(UserType.Client, clientUserId, clientOrganizationId, apiTool.utilityProvider.toString(), bearerTokenType);
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
                        const gsmUsernameSecretId = generateSecretManagerId(UserType.Client, clientUserId, clientOrganizationId, apiTool.utilityProvider.toString(), usernameSecretType);
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
                        const gsmPasswordSecretId = generateSecretManagerId(UserType.Client, clientUserId, clientOrganizationId, apiTool.utilityProvider.toString(), passwordSecretType);
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
                        const basicAuthKeys = getBasicAuthCredentialKeys(apiTool.securityOption);
                        resolvedSecrets[basicAuthKeys.username] = usernameValue;
                        resolvedSecrets[basicAuthKeys.password] = passwordValue;
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
                needsSetup: true,
                utilityProvider: apiTool.utilityProvider,
                title: `Config Required: ${apiTool.openapiSpecification.info.title}`,
                description: `To use '${apiTool.openapiSpecification.info.title}', provide: ${uniqueMissingDetails.map(d=>d.inputPrompt).join(', ')}. Securely stored.`,
                message: `Setup for ${apiTool.openapiSpecification.info.title}.`,
                requiredSecretInputs: requiredStandardSecrets,
                requiredActionConfirmations: [], 
            };

            const executionOutcomeForDb: ApiToolExecutionData = {
                apiToolId: apiTool.id,
                userId: agentServiceCredentials.clientUserId,
                organizationId: agentServiceCredentials.clientOrganizationId,
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

            return { success: true, data: setupNeededData as ApiToolExecutionResult };
        }

        const result : ServiceResponse<ApiToolExecutionResult> = await handleExecution(agentServiceCredentials, apiTool, conversationId, params, resolvedSecrets, logPrefix);

        // Log the execution without blocking the response
        if (result.success) {
            try {
              await logApiToolExecution(apiTool, params, result.data);
              console.debug(`${logPrefix} Successfully logged execution for ${toolId}`);
            } catch (logError) {
              console.error(`${logPrefix} FAILED to log execution for ${toolId}:`, logError);
              // Do not throw or return an error here, the primary execution was successful.
            }
        }

        // After successful execution (not an error, not a setup needed response)
        // Check if result.data is not SetupNeeded
        if (!(typeof result === 'object' && result !== null && 'needsSetup' in result && result.needsSetup === true)) {
            try {
                await updateUserApiToolStatus(clientUserId, clientOrganizationId, toolId, ApiToolStatus.ACTIVE);
                console.log(`${logPrefix} Updated UserApiTool status to ACTIVE for user ${clientUserId}, tool ${toolId}.`);
            } catch (dbUpdateError) {
                // Log error but don't let it fail the overall successful execution response.
                console.error(`${logPrefix} Failed to update UserApiTool status to ACTIVE, but tool execution was successful:`, dbUpdateError);
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