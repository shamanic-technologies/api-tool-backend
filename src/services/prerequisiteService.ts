import {
    ApiTool,
    SuccessResponse,
    AgentServiceCredentials,
    SetupNeeded,
    UtilityInputSecret // Keep for now, for casting target
} from '@agent-base/types';

import { getOperation } from './utils'; // Import from utils

/**
 * Checks prerequisites (Secrets) based on the ApiTool's OpenAPI specification and pre-fetched secrets.
 * This version NO LONGER CALLS secret-service.
 * @param {ApiTool} apiTool The API tool configuration.
 * @param {AgentServiceCredentials} agentServiceCredentials Credentials for the agent (only clientUserId needed here).
 * @param {Record<string, string>} resolvedSecrets Pre-fetched secrets from utilityService (GSM).
 * @returns {Promise<{
 *    prerequisitesMet: boolean;
 *    setupNeededResponse?: SuccessResponse<SetupNeeded>;
 *    credentials?: Record<string, string | null>;
 * }>} Object indicating if prerequisites are met, any setup needed, and fetched credentials.
 */
export const checkPrerequisites = async (
    apiTool: ApiTool,
    agentServiceCredentials: AgentServiceCredentials,
    resolvedSecrets: Record<string, string> // Secrets already fetched by utilityService
): Promise<{ 
    prerequisitesMet: boolean; 
    setupNeededResponse?: SuccessResponse<SetupNeeded>; 
    credentials?: Record<string, string | null>;
}> => {
    const logPrefix = `[PrerequisiteService ${apiTool.id}]`;
    console.log(`${logPrefix} Checking prerequisites using pre-fetched resolvedSecrets...`);
    const { clientUserId } = agentServiceCredentials; // Needed for SetupNeeded response

    const operation = getOperation(apiTool.openapiSpecification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract a single operation for ${apiTool.id}.`);
        return {
            prerequisitesMet: false,
            setupNeededResponse: {
                success: true,
                data: {
                    needsSetup: true,
                    utilityProvider: apiTool.utilityProvider,
                    message: "Invalid tool configuration: Cannot determine API operation.",
                    title: `Configuration Error for ${apiTool.id}`,
                    description: apiTool.openapiSpecification.info.description || `Tool ${apiTool.id}`,
                    requiredSecretInputs: [],
                    requiredActionConfirmations: []
                }
            }
        };
    }

    const fetchedCredentials: Record<string, string | null> = {};
    const missingSetupSecrets: UtilityInputSecret[] = [];
    let allPrerequisitesMet = true;

    const chosenSchemeName = apiTool.securityOption;
    if (!chosenSchemeName) {
        console.log(`${logPrefix} No securityOption for tool ${apiTool.id}. Assuming no auth.`);
        return { prerequisitesMet: true, credentials: {} };
    }

    const securitySchemeObject = apiTool.openapiSpecification.components?.securitySchemes?.[chosenSchemeName];
    if (!securitySchemeObject) {
        console.error(`${logPrefix} securityOption '${chosenSchemeName}' not found in spec for ${apiTool.id}.`);
        return {
            prerequisitesMet: false,
            setupNeededResponse: {
                success: true,
                data: {
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
    }
    
    if ('$ref' in securitySchemeObject) {
        console.error(`${logPrefix} Security scheme '${chosenSchemeName}' for ${apiTool.id} is a $ref. Not supported.`);
        return {
            prerequisitesMet: false,
            setupNeededResponse: {
                success: true,
                data: {
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
    }

    // Logic to check resolvedSecrets based on securitySchemeObject type
    switch (securitySchemeObject.type) {
        case 'apiKey':
            const apiKeyName = securitySchemeObject.name; // e.g., X-API-KEY (header/query name)
            const apiKeySecretType = apiTool.securitySecrets["x-secret-name"]; // e.g., api_secret_key (UtilityInputSecret)
            
            if (!apiKeyName) {
                console.error(`${logPrefix} Misconfig for ${apiTool.id}: apiKey '${chosenSchemeName}' has no 'name'.`);
                allPrerequisitesMet = false; 
                break;
            }
            if (!apiKeySecretType) {
                console.error(`${logPrefix} Misconfig for ${apiTool.id}: apiKey '${chosenSchemeName}' needs 'x-secret-name'.`);
                allPrerequisitesMet = false;
                break;
            }

            if (resolvedSecrets[apiKeyName] && typeof resolvedSecrets[apiKeyName] === 'string') {
                console.log(`${logPrefix} API Key for '${apiKeyName}' found in resolvedSecrets.`);
                fetchedCredentials[apiKeyName] = resolvedSecrets[apiKeyName];
            } else {
                console.warn(`${logPrefix} API Key for '${apiKeyName}' (type: ${apiKeySecretType}) NOT found in resolvedSecrets.`);
                allPrerequisitesMet = false;
                missingSetupSecrets.push(apiKeySecretType as UtilityInputSecret);
            }
            break;

        case 'http':
            if (securitySchemeObject.scheme === 'bearer') {
                const bearerSecretType = apiTool.securitySecrets["x-secret-name"]; // e.g., bearer_token (UtilityInputSecret)
                if (!bearerSecretType) {
                    console.error(`${logPrefix} Misconfig for ${apiTool.id}: HTTP Bearer needs 'x-secret-name'.`);
                    allPrerequisitesMet = false;
                    break;
                }
                // utilityService should place the full "Bearer <token>" string into resolvedSecrets['Authorization']
                if (resolvedSecrets['Authorization'] && typeof resolvedSecrets['Authorization'] === 'string' && resolvedSecrets['Authorization'].startsWith('Bearer ')) {
                    console.log(`${logPrefix} HTTP Bearer 'Authorization' token found in resolvedSecrets.`);
                    fetchedCredentials['Authorization'] = resolvedSecrets['Authorization'];
                } else {
                    console.warn(`${logPrefix} HTTP Bearer 'Authorization' token (underlying type: ${bearerSecretType}) NOT found or invalid in resolvedSecrets.`);
                    allPrerequisitesMet = false;
                    missingSetupSecrets.push(bearerSecretType as UtilityInputSecret);
                }
            } else if (securitySchemeObject.scheme === 'basic') {
                const userSecretType = apiTool.securitySecrets["x-secret-username"];
                const passSecretType = apiTool.securitySecrets["x-secret-password"]; // This is optional

                if (!userSecretType) {
                     console.error(`${logPrefix} Misconfig for ${apiTool.id}: HTTP Basic needs 'x-secret-username'.`);
                     allPrerequisitesMet = false;
                     // If username type isn't defined, can't ask for it.
                     if (passSecretType) missingSetupSecrets.push(passSecretType as UtilityInputSecret); // Still ask for password if defined
                     break;
                }
                
                // utilityService should place the full "Basic <base64_token>" string into resolvedSecrets['Authorization']
                if (resolvedSecrets['Authorization'] && typeof resolvedSecrets['Authorization'] === 'string' && resolvedSecrets['Authorization'].startsWith('Basic ')) {
                    console.log(`${logPrefix} HTTP Basic 'Authorization' token found in resolvedSecrets.`);
                    fetchedCredentials['Authorization'] = resolvedSecrets['Authorization'];
                } else {
                    console.warn(`${logPrefix} HTTP Basic 'Authorization' token NOT found or invalid in resolvedSecrets.`);
                    allPrerequisitesMet = false;
                    // If Basic Auth header is missing, then both username and password (if defined) are considered missing for setup form.
                    missingSetupSecrets.push(userSecretType as UtilityInputSecret);
                    if (passSecretType) {
                        missingSetupSecrets.push(passSecretType as UtilityInputSecret);
                    }
                }
            } else {
                console.warn(`${logPrefix} Unsupp. HTTP scheme for ${apiTool.id}: ${securitySchemeObject.scheme}`);
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
            console.warn(`${logPrefix} Unsupp. security scheme type for ${apiTool.id}: ${securitySchemeObject.type}`);
            allPrerequisitesMet = false; // Or handle as a tool configuration error
    }

    if (!allPrerequisitesMet) {
        const finalMissingSecrets = missingSetupSecrets.filter(
            (secret): secret is UtilityInputSecret => secret !== undefined
        );
        const uniqueMissingSetupSecrets = Array.from(new Set(finalMissingSecrets));
        
        if (uniqueMissingSetupSecrets.length === 0) {
            console.warn(`${logPrefix} Prereqs failed (misconfig?), but no specific secrets to request for ${apiTool.id}.`);
             return {
                prerequisitesMet: false,
                setupNeededResponse: {
                    success: true,
                    data: {
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
        }

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
        return { prerequisitesMet: false, setupNeededResponse: { success: true, data: setupNeededData } };
    }

    console.log(`${logPrefix} All prereqs met using resolvedSecrets for ${apiTool.id}.`);
    return { prerequisitesMet: true, credentials: fetchedCredentials };
}; 