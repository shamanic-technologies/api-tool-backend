import {
    // @ts-ignore - This type exists but is not being recognized by the linter.
    ApiToolExecutionResult,
    AgentInternalCredentials,
    ServiceResponse,
    GetUserOAuthInput,
    CheckUserOAuthResult,
    CheckUserOAuthValidResult,
    CheckUserOAuthInvalidResult,
} from '@agent-base/types';
import { checkAuthExternalApiService } from '@agent-base/api-client';

const AGENT_BASE_API_URL = process.env.AGENT_BASE_API_URL;

export async function handleOauthCheck(apiTool: any, agentInternalCredentials: AgentInternalCredentials): Promise<ServiceResponse<ApiToolExecutionResult | { accessToken: string }>> {
    const securityScheme = apiTool.openapiSpecification.components.securitySchemes[apiTool.securityOption];

    if (!securityScheme || securityScheme.type !== 'oauth2') {
        return { success: true, data: { accessToken: '' } }; // Not an OAuth tool
    }

    if (!AGENT_BASE_API_URL) {
        console.error('[OAuth Service] AGENT_BASE_API_URL is not defined.');
        return { success: false, error: 'API Gateway URL is not configured.' };
    }
    
    const provider = apiTool.securityOption.replace('_oauth', '');
    const scopes = Object.keys(securityScheme.flows.authorizationCode.scopes);

    const body: GetUserOAuthInput = {
        clientUserId: agentInternalCredentials.clientUserId,
        clientOrganizationId: agentInternalCredentials.clientOrganizationId,
        oauthProvider: provider,
        requiredScopes: scopes
    };

    try {
        const authCheckResponse: ServiceResponse<CheckUserOAuthResult> = await checkAuthExternalApiService(body, agentInternalCredentials);

        if (!authCheckResponse.success) {
            console.error('[OAuth Service] Error checking OAuth status:', authCheckResponse.error);
            return authCheckResponse;
        }

        const authCheckResult = authCheckResponse.data as CheckUserOAuthResult;

        if (!authCheckResult.valid) {
            const authCheckInvalidResult = authCheckResult as CheckUserOAuthInvalidResult;
            return {
                success: true,
                data: {
                    needsAuth: true,
                    authUrl: authCheckInvalidResult.authUrl
                }
            };
        } else {
            const authCheckValidResult = authCheckResult as CheckUserOAuthValidResult;
            return {
                success: true,
                data: {
                    accessToken: authCheckValidResult.oauthCredentials[0].accessToken
                }
            };
        }
    } catch (error) {
        console.error('[OAuth Service] Error checking OAuth status:', error);
        return { success: false, error: 'Failed to check OAuth status.' };
    }
} 