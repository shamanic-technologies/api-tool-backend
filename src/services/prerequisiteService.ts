import {
    ApiTool,
    AgentInternalCredentials,
    SetupNeeded,
    UtilityInputSecret // Keep for now, for casting target
} from '@agent-base/types';

import { getOperation, getCredentialKeyForScheme, getBasicAuthCredentialKeys } from './utils.js'; // Import from utils, including new helpers
import { OperationObject } from 'openapi3-ts/oas30';

/**
 * Checks prerequisites (Secrets) based on the ApiTool's OpenAPI specification and pre-fetched secrets.
 * This version NO LONGER CALLS secret-service.
 * @param {ApiTool} apiTool The API tool configuration.
 * @param {AgentInternalCredentials} agentServiceCredentials Credentials for the agent (only clientUserId needed here).
 * @param {Record<string, string>} resolvedSecrets Pre-fetched secrets from utilityService (GSM).
 * @returns {Promise<{
 *    setupNeeded?: SetupNeeded;
 *    credentials?: Record<string, string | null>;
 * }>} Object indicating if prerequisites are met, any setup needed, and fetched credentials.
 */
export const checkPrerequisites = async (
    apiTool: ApiTool,
    agentServiceCredentials: AgentInternalCredentials,
    resolvedSecrets: Record<string, string> // Secrets already fetched by utilityService
): Promise<{ 
    setupNeeded?: SetupNeeded; 
    credentials?: Record<string, string | null>;
}> => {
    const logPrefix = `[PrerequisiteService ${apiTool.id}]`;

    const operation : OperationObject | null = getOperation(apiTool.openapiSpecification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract a single operation for ${apiTool.id}.`);
        return {
            setupNeeded: {
                needsSetup: true,
                utilityProvider: apiTool.utilityProvider,
                message: "Invalid tool configuration: Cannot determine API operation.",
                title: `Configuration Error for ${apiTool.id}`,
                description: apiTool.openapiSpecification.info.description || `Tool ${apiTool.id}`,
                requiredSecretInputs: [],
                requiredActionConfirmations: []
            }
        };
    }

    const fetchedCredentials: Record<string, string | null> = {};
    const missingSetupSecrets: UtilityInputSecret[] = [];
    let allPrerequisitesMet = true;

    const chosenSchemeName = apiTool.securityOption;
    if (!chosenSchemeName) {
        console.log(`${logPrefix} No securityOption for tool ${apiTool.id}. Assuming no auth.`);
        return { credentials: {} };
    }

    const securitySchemeObject = apiTool.openapiSpecification.components?.securitySchemes?.[chosenSchemeName];
    if (!securitySchemeObject) {
        console.error(`${logPrefix} securityOption '${chosenSchemeName}' not found in spec for ${apiTool.id}.`);
        return {
            setupNeeded: {
                needsSetup: true,
                utilityProvider: apiTool.utilityProvider,
                message: `Invalid tool configuration: Security option '${chosenSchemeName}' not defined.`, 
                title: `Configuration Error for ${apiTool.id}`,
                description: `Check openapiSpecification for tool ${apiTool.id}.`,
                requiredSecretInputs: [],
                requiredActionConfirmations: []
            }
        }
    };
    
    if ('$ref' in securitySchemeObject) {
        return {
            setupNeeded: {
                needsSetup: true,
                utilityProvider: apiTool.utilityProvider,
                message: `Invalid tool configuration: Security option '${chosenSchemeName}' is a $ref.`, 
                title: `Configuration Error for ${apiTool.id}`,
                description: `Define security schemes directly for tool ${apiTool.id}.`,
                requiredSecretInputs: [],
                requiredActionConfirmations: []
            }
        }
    };

    // Logic to check resolvedSecrets based on securitySchemeObject type
    switch (securitySchemeObject.type) {
        case 'apiKey':
            const apiKeyHeaderQueryName = securitySchemeObject.name; // e.g., X-API-KEY (actual header/query name)
            const apiKeySecretType = apiTool.securitySecrets["x-secret-name"]; // e.g., api_secret_key (UtilityInputSecret)
            const apiKeySchemeKey : string = getCredentialKeyForScheme(chosenSchemeName); // Key used in resolvedSecrets, e.g., "myApiKeyAuth"
            
            if (!apiKeyHeaderQueryName) { // securitySchemeObject.name is required for apiKey by OpenAPI
                console.error(`${logPrefix} Misconfig for ${apiTool.id}: apiKey '${chosenSchemeName}' has no 'name' in its spec.`);
                allPrerequisitesMet = false; 
                break;
            }
            if (!apiKeySecretType) {
                console.error(`${logPrefix} Misconfig for ${apiTool.id}: apiKey '${chosenSchemeName}' needs 'x-secret-name' in tool's securitySecrets.`);
                allPrerequisitesMet = false;
                break;
            }

            // Check if the raw API key is present in resolvedSecrets under the scheme name key
            if (resolvedSecrets[apiKeySchemeKey] && typeof resolvedSecrets[apiKeySchemeKey] === 'string') {
                // Pass the raw key to apiCallService, it will use securitySchemeObject.name and securitySchemeObject.in
                fetchedCredentials[apiKeySchemeKey] = resolvedSecrets[apiKeySchemeKey];
            } else {
                console.error(`${logPrefix} API Key (raw value for scheme '${chosenSchemeName}', type: ${apiKeySecretType}) NOT found in resolvedSecrets under key '${apiKeySchemeKey}'.`);
                allPrerequisitesMet = false;
                missingSetupSecrets.push(apiKeySecretType as UtilityInputSecret);
            }
            break;

        case 'http':
            if (securitySchemeObject.scheme === 'bearer') {
                const bearerSecretType = apiTool.securitySecrets["x-secret-name"]; // e.g., bearer_token_type (UtilityInputSecret)
                const bearerSchemeKey = getCredentialKeyForScheme(chosenSchemeName); // Key used in resolvedSecrets

                if (!bearerSecretType) {
                    console.error(`${logPrefix} Misconfig for ${apiTool.id}: HTTP Bearer scheme '${chosenSchemeName}' needs 'x-secret-name' in tool's securitySecrets.`);
                    allPrerequisitesMet = false;
                    break;
                }

                // Check if the raw bearer token is present in resolvedSecrets under the scheme name key
                if (resolvedSecrets[bearerSchemeKey] && typeof resolvedSecrets[bearerSchemeKey] === 'string') {
                    // Pass the raw token to apiCallService
                    fetchedCredentials[bearerSchemeKey] = resolvedSecrets[bearerSchemeKey];
                } else {
                    console.warn(`${logPrefix} HTTP Bearer token (raw value for scheme '${chosenSchemeName}', underlying type: ${bearerSecretType}) NOT found or invalid in resolvedSecrets under key '${bearerSchemeKey}'.`);
                    allPrerequisitesMet = false;
                    missingSetupSecrets.push(bearerSecretType as UtilityInputSecret);
                }
            } else if (securitySchemeObject.scheme === 'basic') {
                const userSecretType = apiTool.securitySecrets["x-secret-username"];
                const passSecretType = apiTool.securitySecrets["x-secret-password"]; // This is optional

                if (!userSecretType) { // Username is essential for basic auth
                     console.error(`${logPrefix} Misconfig for ${apiTool.id}: HTTP Basic scheme '${chosenSchemeName}' needs 'x-secret-username' in tool's securitySecrets.`);
                     allPrerequisitesMet = false;
                     if (passSecretType) missingSetupSecrets.push(passSecretType as UtilityInputSecret); // Still ask for password's UtilityInputSecret type if defined
                     break;
                }
                
                const basicAuthKeys = getBasicAuthCredentialKeys(chosenSchemeName);

                // Check if the raw username component is present in resolvedSecrets
                if (resolvedSecrets[basicAuthKeys.username] && typeof resolvedSecrets[basicAuthKeys.username] === 'string') {
                    fetchedCredentials[basicAuthKeys.username] = resolvedSecrets[basicAuthKeys.username];
                    
                    // Handle password
                    if (passSecretType) { // If a password secret type is configured for the tool
                        const passwordValue = resolvedSecrets[basicAuthKeys.password];
                        if (passwordValue && typeof passwordValue === 'string' && passwordValue !== "") {
                            // Password key exists, is a string, AND is not an empty string
                            fetchedCredentials[basicAuthKeys.password] = passwordValue;
                        } else {
                            // Password key is missing, not a string, OR its value is an empty string.
                            // Since passSecretType is defined, this means the required secret is missing or empty.
                            console.error(`${logPrefix} HTTP Basic password component (type: ${passSecretType}) configured but value is missing, not a string, or empty in resolvedSecrets.`);
                            allPrerequisitesMet = false;
                            missingSetupSecrets.push(passSecretType as UtilityInputSecret);
                            // Pass on the (potentially empty or null) value if it exists, apiCallService might handle it
                            fetchedCredentials[basicAuthKeys.password] = typeof passwordValue === 'string' ? passwordValue : null;
                        }
                    } else {
                        // No password configured via passSecretType (x-secret-password was not in tool's securitySecrets)
                        // Treat as legitimately absent or optional. apiCallService defaults to empty string if missing or null.
                        fetchedCredentials[basicAuthKeys.password] = null; 
                        console.error(`${logPrefix} HTTP Basic password component not configured via tool's securitySecrets.`);
                    }
                } else {
                    console.error(`${logPrefix} HTTP Basic username component (type: ${userSecretType}) NOT found in resolvedSecrets for scheme '${chosenSchemeName}' under key '${basicAuthKeys.username}'.`);
                    allPrerequisitesMet = false;
                    missingSetupSecrets.push(userSecretType as UtilityInputSecret);
                    if (passSecretType) { // If password was also expected
                        missingSetupSecrets.push(passSecretType as UtilityInputSecret);
                    }
                }
            } else {
                console.error(`${logPrefix} Unsupp. HTTP scheme for ${apiTool.id}: ${securitySchemeObject.scheme}`);
                allPrerequisitesMet = false; // Or handle as a tool configuration error
            }
            break;
        
        // case 'oauth2': 
        //     // OAuth2 would require a different flow, likely not just checking resolvedSecrets for a static token.
        //     // It might involve checking for an access token and refresh token, and potentially initiating a refresh flow.
        //     // For now, this implies setup is needed if OAuth2 is the scheme.
        //     console.log(`${logPrefix} OAuth2 security scheme selected. This version assumes setup is needed or token is managed externally.`);
        //     allPrerequisitesMet = false; // Or specific logic to check for existing valid tokens in resolvedSecrets.
        //     // missingSetupSecrets.push( UtilityInputSecret.OAUTH_TOKEN ); // Example, if you had such a generic type.
        //     break;

        default:
            console.error(`${logPrefix} Unsupp. security scheme type for ${apiTool.id}: ${securitySchemeObject.type}`);
            allPrerequisitesMet = false; // Or handle as a tool configuration error
    }

    if (!allPrerequisitesMet) {
        const finalMissingSecrets = missingSetupSecrets.filter(
            (secret): secret is UtilityInputSecret => secret !== undefined
        );
        const uniqueMissingSetupSecrets = Array.from(new Set(finalMissingSecrets));
        
        if (uniqueMissingSetupSecrets.length === 0) {
            console.error(`${logPrefix} Prereqs failed (misconfig?), but no specific secrets to request for ${apiTool.id}.`);
             return {
                setupNeeded: {
                    needsSetup: true,
                    utilityProvider: apiTool.utilityProvider,
                    message: `Tool Misconfiguration: ${apiTool.openapiSpecification.info.title}. Check server logs.`, 
                    title: `Configuration Error: ${apiTool.openapiSpecification.info.title}`,
                    description: `Tool ${apiTool.id} config issue. Contact admin.`, 
                    requiredSecretInputs: [],
                    requiredActionConfirmations: [],
                    oauthUrl: undefined 
                }
            }
        }; 

        const setupNeededData: SetupNeeded = {
            needsSetup: true,
            utilityProvider: apiTool.utilityProvider,
            message: `Config needed for ${apiTool.openapiSpecification.info.title}. Some secrets missing.`, 
            title: `Reconfigure ${apiTool.openapiSpecification.info.title}`,
            description: apiTool.openapiSpecification.info.description || `Setup for ${apiTool.id}. Provide secrets.`, 
            requiredSecretInputs: uniqueMissingSetupSecrets, 
            requiredActionConfirmations: [],
            oauthUrl: undefined 
        };
        return { setupNeeded: setupNeededData };
    }

    return { credentials: fetchedCredentials };
}; 