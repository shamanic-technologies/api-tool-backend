import {
    // @ts-ignore - This type exists but is not being recognized by the linter.
    ApiToolExecutionResult,
    AgentInternalCredentials,
    ServiceResponse,
    AgentBaseCredentials,
    GetUserOAuthInput,
} from '@agent-base/types';
import { checkAuthExternalApiService } from '@agent-base/api-client';

const AGENT_BASE_API_URL = process.env.AGENT_BASE_API_URL;

export async function handleOauthCheck(apiTool: any, agentServiceCredentials: AgentInternalCredentials): Promise<ServiceResponse<ApiToolExecutionResult | { accessToken: string }>> {
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
        userId: agentServiceCredentials.clientUserId,
        organizationId: agentServiceCredentials.clientOrganizationId,
        oauthProvider: provider,
        requiredScopes: scopes
    };

    const credentials: AgentBaseCredentials = {
        platformApiKey: process.env.INTERNAL_SECRET!,
        clientAuthUserId: agentServiceCredentials.clientUserId,
        clientAuthOrganizationId: agentServiceCredentials.clientOrganizationId
    };

    try {
        const authCheckResponse = await checkAuthExternalApiService(body, credentials);

        if (authCheckResponse.success === false) {
            return authCheckResponse;
        }

        if (authCheckResponse.data.hasAuth === false) {
            return {
                success: true,
                // @ts-ignore - Casting to ApiToolExecutionResult as per user instruction.
                data: {
                    needsAuth: true,
                    authUrl: authCheckResponse.data.authUrl
                }
            };
        } else {
            return {
                success: true,
                data: {
                    accessToken: authCheckResponse.data.oauthCredentials[0].accessToken
                }
            };
        }
    } catch (error) {
        console.error('[OAuth Service] Error checking OAuth status:', error);
        return { success: false, error: 'Failed to check OAuth status.' };
    }
} 