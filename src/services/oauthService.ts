import axios from 'axios';
import {
    // @ts-ignore - This type exists but is not being recognized by the linter.
    ApiToolExecutionResult,
    AgentInternalCredentials,
    ServiceResponse,
} from '@agent-base/types';

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

    try {
        const authCheckResponse = await axios.post(`${AGENT_BASE_API_URL}/tool-auth/api/check-auth`, {
            userId: agentServiceCredentials.clientUserId,
            organizationId: agentServiceCredentials.clientOrganizationId,
            oauthProvider: provider,
            requiredScopes: scopes
        });

        if (authCheckResponse.data?.data?.hasAuth === false) {
            return {
                success: true,
                // @ts-ignore - Casting to ApiToolExecutionResult as per user instruction.
                data: {
                    needsAuth: true,
                    authUrl: authCheckResponse.data.data.authUrl
                }
            };
        } else if (authCheckResponse.data?.data?.hasAuth === true) {
            return {
                success: true,
                data: {
                    accessToken: authCheckResponse.data.data.oauthCredentials[0].accessToken
                }
            };
        } else {
            // Handle unexpected response structure
            console.error('[OAuth Service] Unexpected response structure from tool-auth service:', authCheckResponse.data);
            return { success: false, error: 'Unexpected response from authentication service.' };
        }
    } catch (error) {
        console.error('[OAuth Service] Error checking OAuth status:', error);
        return { success: false, error: 'Failed to check OAuth status.' };
    }
} 