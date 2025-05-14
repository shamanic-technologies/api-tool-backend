import {
    ExternalUtilityTool,
    AuthMethod,
    SuccessResponse,
    UtilityActionConfirmation,
    UtilityInputSecret,
    mapUtilityProviderToOAuthProvider,
    ServiceResponse,
    SecretValue,
    GetSecretRequest,
    UserType,
    AgentServiceCredentials,
    UtilityProvider,
    UtilitySecretType,
    SetupNeeded
} from '@agent-base/types';

// Import client functions
// import { checkAuth, CheckAuthResultData } from '../clients/toolAuthServiceClient';
import { getSecretApiClient } from '@agent-base/api-client';

/**
 * Checks prerequisites (Secrets, Actions, OAuth).
 * @param externalUtilityTool The tool configuration.
 * @param agentServiceCredentials The user ID.
 * @param logPrefix Logging prefix.
 * @returns An object indicating if prerequisites are met, any setup needed response, and credentials.
 */
export const checkPrerequisites = async (
    externalUtilityTool: ExternalUtilityTool,
    agentServiceCredentials: AgentServiceCredentials,
): Promise<{ 
    prerequisitesMet: boolean; 
    setupNeededResponse?: SuccessResponse<SetupNeeded>; 
    credentials?: { apiKey?: string | null; oauthToken?: string | null };
}> => {
    const logPrefix = '[PrerequisiteService]';
    console.log(`${logPrefix} Checking prerequisites...`);
    const { platformUserId, platformApiKey, clientUserId } = agentServiceCredentials;
    let allSecretsAvailable = true;
    let oauthAuthorized = true;
    let fetchedApiKey: string | null = null;
    let fetchedOauthToken: string | null = null;
    let requiredSecretInputs: UtilityInputSecret[] = [];
    let requiredActionConfirmations: UtilityActionConfirmation[] = [];

    // --- Check Secrets and Actions --- 
    if (externalUtilityTool.requiredSecrets && externalUtilityTool.requiredSecrets.length > 0) {
        try {
            for (const secretKey of externalUtilityTool.requiredSecrets) {
                const getSecretRequest : GetSecretRequest ={
                    userType: UserType.Client,
                    secretUtilityProvider: externalUtilityTool.utilityProvider,
                    secretType: secretKey as UtilitySecretType
                };
                const secretValueResponse : ServiceResponse<SecretValue> = await getSecretApiClient(
                    getSecretRequest,
                    platformUserId,
                    platformApiKey,
                    clientUserId
                );
                if (!secretValueResponse.success) {
                    console.error(`${logPrefix} Error fetching secret: ${secretKey}`);
                    throw new Error(`Error fetching secret: ${secretKey}`);
                }
                const secretValue = secretValueResponse.data.value;

                // --- START CHANGE ---
                // Store the API key if this is the designated API key secret
                if (secretKey === UtilityInputSecret.API_SECRET_KEY) {
                    fetchedApiKey = secretValue;
                    if (fetchedApiKey) {
                        console.log(`${logPrefix} Fetched API key.`);
                    } else {
                        console.log(`${logPrefix} API key secret found but value is not a string or is null.`);
                    }
                }
                if (secretKey === UtilityActionConfirmation.OAUTH_DONE && secretValue !== 'true') {
                    console.log(`${logPrefix} Missing or invalid confirmation action: ${secretKey}`);
                    allSecretsAvailable = false;
                    requiredActionConfirmations.push(secretKey as UtilityActionConfirmation);
                } 
                if (secretKey === UtilityActionConfirmation.WEBHOOK_URL_INPUTED && secretValue !== 'true') {
                    console.log(`${logPrefix} Missing or invalid confirmation action: ${secretKey}`);
                    allSecretsAvailable = false;
                    requiredActionConfirmations.push(secretKey as UtilityActionConfirmation);
                } else if (!secretValue) {
                    console.log(`${logPrefix} Missing or invalid secret: ${secretKey}`);
                    allSecretsAvailable = false;
                    requiredSecretInputs.push(secretKey as UtilityInputSecret);
                }
            }
        } catch (err) {
            throw err; 
        }
    }

    // --- Check OAuth --- 
    if (externalUtilityTool.authMethod === AuthMethod.OAUTH) {
        const oauthProvider = mapUtilityProviderToOAuthProvider(externalUtilityTool.utilityProvider);
        if (!externalUtilityTool.requiredScopes || externalUtilityTool.requiredScopes.length === 0) {
             console.error(`${logPrefix} OAuth tool requires requiredScopes.`);
             throw new Error(`Configuration error: OAuth tool '${externalUtilityTool.id}' must define requiredScopes.`);
        }
        try {
            // Mock response for now
            const authResponse = {success: true, data: {hasAuth: true, authUrl: 'https://example.com/auth', credentials: [{accessToken: '1234567890'}]}, error: null};
            
            // : ServiceResponse<CheckAuthResultData> = await checkAuth({ userId: agentServiceCredentials, oauthProvider, requiredScopes: externalUtilityTool.requiredScopes });
            if (!authResponse.success) {
                console.error(`${logPrefix} Auth check client call failed: ${authResponse.error}`);
                throw new Error(`Tool Auth Service communication failed: ${authResponse.error}`);
            }
            const authData = authResponse.data;
            if (!authData.hasAuth) {
                oauthAuthorized = false;
                const authUrl = authData.authUrl;
                console.log(`${logPrefix} OAuth not authorized. Auth URL: ${authUrl}`);
                if (!authUrl) {
                    console.error(`${logPrefix} OAuth requires setup, but no authUrl provided by auth service.`);
                    throw new Error('OAuth setup required, but authorization URL is missing.');
                }
                const setupResponse: SuccessResponse<SetupNeeded> = {
                    success: true,
                    data: {
                        needsSetup: true,
                        utilityProvider: externalUtilityTool.utilityProvider,
                        message: `Authentication required for ${externalUtilityTool.utilityProvider}.`, 
                        title: `Connect ${externalUtilityTool.utilityProvider}`, 
                        description: externalUtilityTool.description,
                        requiredSecretInputs: [], 
                        requiredActionConfirmations: [UtilityActionConfirmation.OAUTH_DONE],
                        oauthUrl: authUrl
                    }
                };
                return { prerequisitesMet: false, setupNeededResponse: setupResponse }; 
            }
            fetchedOauthToken = authData.credentials?.[0]?.accessToken ?? null; 
            if (!fetchedOauthToken) {
                console.error(`${logPrefix} OAuth authorized but no access token found in credentials.`);
                throw new Error('OAuth token missing despite successful auth check.');
            }
             console.log(`${logPrefix} OAuth authorized.`);
        } catch (err) {
            throw err;
        }
    }
    
    // --- Determine Overall Status --- 
    const prerequisitesMet = allSecretsAvailable && oauthAuthorized;

    if (!prerequisitesMet) {
        const setupResponse: SuccessResponse<SetupNeeded> = {
            success: true,
            data: {
                needsSetup: true,
                utilityProvider: externalUtilityTool.utilityProvider,
                message: `Configuration required for ${externalUtilityTool.utilityProvider}. Please provide the following details or confirm actions.`, 
                title: `Configure ${externalUtilityTool.utilityProvider}`, 
                description: externalUtilityTool.description,
                requiredSecretInputs: requiredSecretInputs,
                requiredActionConfirmations: requiredActionConfirmations
            }
        };
        return { prerequisitesMet: false, setupNeededResponse: setupResponse };
    }

    console.log(`${logPrefix} All prerequisites met.`);
    const credentials = {
        apiKey: fetchedApiKey,
        oauthToken: fetchedOauthToken
    };
    return { prerequisitesMet: true, credentials };
}; 