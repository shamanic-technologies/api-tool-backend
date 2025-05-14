import {
    ApiTool,
    // ExternalUtilityTool, // Removed
    // AuthMethod, // Removed
    SuccessResponse,
    // UtilityActionConfirmation, // Removed - to be replaced by OpenAPI driven setup logic
    // UtilityInputSecret, // Removed - to be replaced by x-shamanic-secret-name or similar
    // mapUtilityProviderToOAuthProvider, // Removed - OAuth provider info should come from OpenAPI or ApiTool
    ServiceResponse,
    SecretValue,
    GetSecretRequest,
    UserType,
    AgentServiceCredentials,
    UtilityProvider, // May still be needed for secret service or OAuth provider mapping
    UtilitySecretType, // May need to be adapted or used with x-shamanic-secret-name
    SetupNeeded,
    UtilityInputSecret // Keep for now, for casting target
} from '@agent-base/types';
import {
    OpenAPIObject,
    OperationObject,
    SecuritySchemeObject,
    ReferenceObject,
    SecurityRequirementObject
} from 'openapi3-ts/oas30';

// Import client functions
// import { checkAuth, CheckAuthResultData } from '../clients/toolAuthServiceClient';
import { getSecretApiClient } from '@agent-base/api-client';
import { getOperation } from './utils'; // Import from utils

/**
 * Generates a secret key name based on the OpenAPI security scheme name and item type.
 * e.g., schemeName='ApiKeyAuth', itemType='apiKey' -> 'ApiKeyAuth-apiKey'
 * @param {string} schemeName The name of the security scheme from OpenAPI.
 * @param {'apiKey' | 'username' | 'password' | 'bearerToken'} itemType The type of the auth item.
 * @returns {string} The generated secret key name.
 */
const generateSecretKeyName = (
    schemeName: string, 
    itemType: 'apiKey' | 'username' | 'password' | 'bearerToken'
): string => {
    return `${schemeName}-${itemType}`;
};

/**
 * Checks prerequisites (Secrets, OAuth) based on the ApiTool's OpenAPI specification.
 * @param {ApiTool} apiTool The API tool configuration.
 * @param {AgentServiceCredentials} agentServiceCredentials Credentials for the agent.
 * @returns {Promise<{
 *    prerequisitesMet: boolean;
 *    setupNeededResponse?: SuccessResponse<SetupNeeded>;
 *    credentials?: Record<string, string | null>; // Stores fetched API keys or tokens
 * }>} Object indicating if prerequisites are met, any setup needed, and fetched credentials.
 */
export const checkPrerequisites = async (
    apiTool: ApiTool,
    agentServiceCredentials: AgentServiceCredentials,
): Promise<{ 
    prerequisitesMet: boolean; 
    setupNeededResponse?: SuccessResponse<SetupNeeded>; 
    credentials?: Record<string, string | null>;
}> => {
    const logPrefix = `[PrerequisiteService ${apiTool.id}]`;
    console.log(`${logPrefix} Checking prerequisites using new ApiTool structure...`);
    const { platformUserId, platformApiKey, clientUserId } = agentServiceCredentials;

    const operation = getOperation(apiTool.openapiSpecification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract a single operation from ApiTool openapiSpecification.`);
        return {
            prerequisitesMet: false,
            setupNeededResponse: {
                success: true,
                data: {
                    needsSetup: true,
                    utilityProvider: apiTool.utilityProvider,
                    message: "Invalid tool configuration: Cannot determine API operation.",
                    title: `Configuration Error: ${apiTool.utilityProvider.toString()}`,
                    description: apiTool.openapiSpecification.info.description || `Tool ${apiTool.id}`,
                    requiredSecretInputs: [],
                    requiredActionConfirmations: []
                }
            }
        };
    }

    let allPrerequisitesMet = true;
    const fetchedCredentials: Record<string, string | null> = {};
    const requiredSecretsForSetup: UtilityInputSecret[] = []; 

    const chosenSchemeName = apiTool.securityOption;
    if (!chosenSchemeName) {
        console.log(`${logPrefix} No securityOption defined for this tool. Assuming no auth needed.`);
        return { prerequisitesMet: true, credentials: {} };
    }

    const securitySchemeObject = apiTool.openapiSpecification.components?.securitySchemes?.[chosenSchemeName];
    if (!securitySchemeObject) {
        console.error(`${logPrefix} Defined securityOption '${chosenSchemeName}' not found in openapiSpecification.components.securitySchemes.`);
        // This is a configuration error of the ApiTool itself.
        return { prerequisitesMet: false, /* ... appropriate SetupNeeded error ... */ };
    }
    
    // Resolve $ref for security scheme if necessary
    let resolvedSecurityScheme: SecuritySchemeObject;
    if ((securitySchemeObject as ReferenceObject).$ref) {
        const refPath = (securitySchemeObject as ReferenceObject).$ref;
        if (refPath.startsWith('#/components/securitySchemes/')) {
            const actualSchemeName = refPath.substring('#/components/securitySchemes/'.length);
            const resolved = apiTool.openapiSpecification.components?.securitySchemes?.[actualSchemeName];
            if (!resolved || (resolved as ReferenceObject).$ref) {
                console.error(`${logPrefix} Failed to resolve securityScheme $ref or found nested $ref: ${refPath}`);
                return { prerequisitesMet: false, /* ... appropriate SetupNeeded error ... */ };
            }
            resolvedSecurityScheme = resolved as SecuritySchemeObject;
        } else {
            console.error(`${logPrefix} Unsupported securityScheme $ref: ${refPath}`);
            return { prerequisitesMet: false, /* ... appropriate SetupNeeded error ... */ };
        }
    } else {
        resolvedSecurityScheme = securitySchemeObject as SecuritySchemeObject;
                }

    const secretsToFetchMap = apiTool.securitySecrets;

    switch (resolvedSecurityScheme.type) {
        case 'apiKey':
            const apiKeySecretEnum = secretsToFetchMap["x-secret-name"];
            if (!apiKeySecretEnum) {
                console.error(`${logPrefix} Misconfiguration: apiKey scheme '${chosenSchemeName}' chosen, but no 'x-secret-name' in securitySecrets.`);
                allPrerequisitesMet = false;
                // Potentially add a generic error to SetupNeeded or make it a hard error
            } else {
                try {
                    const secretResponse = await getSecretApiClient(
                        { userType: UserType.Client, secretUtilityProvider: apiTool.utilityProvider, secretType: apiKeySecretEnum },
                        platformUserId, platformApiKey, clientUserId
                    );
                    if (secretResponse.success && secretResponse.data.value) {
                        fetchedCredentials[chosenSchemeName] = secretResponse.data.value;
                    } else {
                        allPrerequisitesMet = false;
                        requiredSecretsForSetup.push(apiKeySecretEnum);
                    }
                } catch (err) {
                    console.error(`${logPrefix} Error fetching secret ${apiKeySecretEnum} for scheme '${chosenSchemeName}':`, err);
                    allPrerequisitesMet = false;
                    requiredSecretsForSetup.push(apiKeySecretEnum);
                } 
            }
            break;

        case 'http':
            if (resolvedSecurityScheme.scheme === 'bearer') {
                const bearerSecretEnum = secretsToFetchMap["x-secret-name"];
                if (!bearerSecretEnum) {
                     console.error(`${logPrefix} Misconfiguration: HTTP Bearer scheme '${chosenSchemeName}' chosen, but no 'x-secret-name' in securitySecrets.`);
                     allPrerequisitesMet = false;
                } else {
                    try {
                        const secretResponse = await getSecretApiClient(
                            { userType: UserType.Client, secretUtilityProvider: apiTool.utilityProvider, secretType: bearerSecretEnum },
                            platformUserId, platformApiKey, clientUserId
                        );
                        if (secretResponse.success && secretResponse.data.value) {
                            fetchedCredentials[chosenSchemeName] = secretResponse.data.value;
                        } else {
                            allPrerequisitesMet = false;
                            requiredSecretsForSetup.push(bearerSecretEnum);
            }
        } catch (err) {
                        console.error(`${logPrefix} Error fetching secret ${bearerSecretEnum} for scheme '${chosenSchemeName}':`, err);
                        allPrerequisitesMet = false;
                        requiredSecretsForSetup.push(bearerSecretEnum);
                    }
                }
            } else if (resolvedSecurityScheme.scheme === 'basic') {
                const userSecretEnum = secretsToFetchMap["x-secret-username"];
                const passSecretEnum = secretsToFetchMap["x-secret-password"]; // Optional

                if (!userSecretEnum) {
                    console.error(`${logPrefix} Misconfiguration: HTTP Basic scheme '${chosenSchemeName}' chosen, but no 'x-secret-username' in securitySecrets.`);
                    allPrerequisitesMet = false;
                } else {
                    try {
                        const userRes = await getSecretApiClient(
                            { userType: UserType.Client, secretUtilityProvider: apiTool.utilityProvider, secretType: userSecretEnum },
                            platformUserId, platformApiKey, clientUserId
                        );
                        if (userRes.success && userRes.data.value) {
                            fetchedCredentials[chosenSchemeName + '_username'] = userRes.data.value;
                        } else {
                            allPrerequisitesMet = false;
                            requiredSecretsForSetup.push(userSecretEnum);
                        }
                    } catch (err) {
                        console.error(`${logPrefix} Error fetching username secret ${userSecretEnum} for scheme '${chosenSchemeName}':`, err);
                        allPrerequisitesMet = false;
                        requiredSecretsForSetup.push(userSecretEnum);
                }
                }
                if (passSecretEnum) { // Only try to fetch password if it's specified in securitySecrets
                    try {
                        const passRes = await getSecretApiClient(
                            { userType: UserType.Client, secretUtilityProvider: apiTool.utilityProvider, secretType: passSecretEnum },
                            platformUserId, platformApiKey, clientUserId
                        );
                        if (passRes.success && passRes.data.value) {
                            fetchedCredentials[chosenSchemeName + '_password'] = passRes.data.value;
                        } else {
                            // If password secret is configured but not found, it implies it's required by the user
                            allPrerequisitesMet = false;
                            requiredSecretsForSetup.push(passSecretEnum);
                        }
                    } catch (err) {
                        console.error(`${logPrefix} Error fetching password secret ${passSecretEnum} for scheme '${chosenSchemeName}':`, err);
                        allPrerequisitesMet = false;
                        requiredSecretsForSetup.push(passSecretEnum);
            }
                } else if (resolvedSecurityScheme.scheme === 'basic' && !passSecretEnum) {
                    // If basic auth and no password secret mapping provided, assume empty password for this scheme.
                    // apiCallService will handle providing an empty string if this value remains undefined.
                    fetchedCredentials[chosenSchemeName + '_password'] = ""; // Explicitly set empty string for clarity here, or let apiCallService handle undefined.
                }
            }
            break;
        // OAuth2 remains commented out
        default:
            console.warn(`${logPrefix} Unsupported security scheme type: ${resolvedSecurityScheme.type}`);
            allPrerequisitesMet = false;
    }

    if (!allPrerequisitesMet) {
        const setupNeededData: SetupNeeded = {
                needsSetup: true,
            utilityProvider: apiTool.utilityProvider,
            message: `Configuration required for ${apiTool.openapiSpecification.info.title}. Please provide missing secrets or complete authorization.`,
            title: `Configure ${apiTool.openapiSpecification.info.title}`,
            description: apiTool.openapiSpecification.info.description || `Setup for ${apiTool.id}`,
            requiredSecretInputs: requiredSecretsForSetup, // This is now UtilityInputSecret[]
            requiredActionConfirmations: [], 
            oauthUrl: undefined 
        };
        return { prerequisitesMet: false, setupNeededResponse: { success: true, data: setupNeededData } };
    }

    return { prerequisitesMet: true, credentials: fetchedCredentials };
}; 