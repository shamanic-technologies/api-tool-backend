import axios from 'axios';
import { Buffer } from 'buffer'; // Import Buffer for Basic Auth
import { 
    ExternalUtilityTool, 
    AuthMethod, 
    ApiKeyAuthScheme, 
    HttpMethod // Assuming HttpMethod might be needed if method is validated
} from '@agent-base/types';

/**
 * Makes the actual API call based on the tool configuration.
 * @param config The tool configuration.
 * @param params The validated input parameters.
 * @param credentials The fetched credentials (API key or OAuth token).
 * @param logPrefix Logging prefix.
 * @returns The data from the API response.
 * @throws Throws an error if the API call fails.
 */
export const makeApiCall = async (
    config: ExternalUtilityTool, 
    params: Record<string, any>,
    credentials: { apiKey?: string | null; oauthToken?: string | null }, 
    logPrefix: string
): Promise<any> => {
    if (!config.apiDetails) throw new Error("makeApiCall called without apiDetails in config");

    const { method, baseUrl, pathTemplate, paramMappings, staticHeaders } = config.apiDetails;
    let url = baseUrl + pathTemplate;
    const queryParams: Record<string, string> = {};
    let requestBody: any = null;
    const headers: Record<string, string> = { ...staticHeaders };

    // 1. Populate Path Parameters
    if (paramMappings?.path) {
        for (const [schemaKey, placeholder] of Object.entries(paramMappings.path)) {
            if (!params[schemaKey]) throw new Error(`Missing required path parameter: ${schemaKey}`);
            url = url.replace(`{${placeholder}}`, encodeURIComponent(params[schemaKey]));
        }
    }

    // 2. Populate Query Parameters
    if (paramMappings?.query) {
        for (const [schemaKey, queryConfig] of Object.entries(paramMappings.query)) {
            const paramValue = params[schemaKey];
            if (paramValue !== undefined && paramValue !== null) {
                let targetName: string;
                let value: any = paramValue;
                if (typeof queryConfig === 'string') {
                    targetName = queryConfig;
                } else {
                    const configObj = queryConfig as { target: string, transform?: 'joinComma' };
                    targetName = configObj.target;
                    if (configObj.transform === 'joinComma' && Array.isArray(value)) {
                        value = value.join(',');
                    }
                }
                queryParams[targetName] = String(value);
            }
        }
    }

    // 3. Populate Body Parameters (assuming JSON body)
    if (paramMappings?.body) {
        requestBody = {};
        for (const [schemaKey, bodyFieldUntyped] of Object.entries(paramMappings.body)) {
            const bodyField = String(bodyFieldUntyped);
            const paramValue = params[schemaKey];
            if (paramValue !== undefined && paramValue !== null) {
                requestBody[bodyField] = params[schemaKey];
            }
        }
    }

    // 4. Add Authentication Header
    if (config.authMethod === AuthMethod.OAUTH) {
        if (!credentials.oauthToken) throw new Error("OAuth token missing for API call");
        headers['Authorization'] = `Bearer ${credentials.oauthToken}`;
    } else if (config.authMethod === AuthMethod.API_KEY) {
        if (!credentials.apiKey || !config.apiKeyDetails) throw new Error("API key or details missing for API call");
        const { scheme, headerName } = config.apiKeyDetails;
        switch (scheme) {
            case ApiKeyAuthScheme.BEARER:
                headers['Authorization'] = `Bearer ${credentials.apiKey}`;
                break;
            case ApiKeyAuthScheme.BASIC_USER:
                headers['Authorization'] = `Basic ${Buffer.from(`${credentials.apiKey}:`).toString('base64')}`;
                break;
            case ApiKeyAuthScheme.BASIC_PASS:
                 headers['Authorization'] = `Basic ${Buffer.from(`:${credentials.apiKey}`).toString('base64')}`;
                 break;
            case ApiKeyAuthScheme.HEADER:
                if (!headerName) throw new Error("Header name missing for API key scheme 'Header'");
                headers[headerName] = credentials.apiKey;
                break;
            default:
                 throw new Error(`Unsupported API key scheme: ${scheme}`);
        }
    }

    console.log(`${logPrefix} Making API call: ${method} ${url}`);
    console.log(`${logPrefix} Headers:`, headers); // Be careful logging headers in production
    console.log(`${logPrefix} Query Params:`, queryParams);
    console.log(`${logPrefix} Body:`, requestBody);

    try {
        const response = await axios({
            method: method,
            url: url,
            params: queryParams,
            data: requestBody,
            headers: headers,
        });
        console.log(`${logPrefix} API response status: ${response.status}`);
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`${logPrefix} Axios error: Status ${error.response?.status}, Data:`, error.response?.data);
        }
        throw error; // Re-throw to be handled by the orchestrator (handleExecution)
    }
}; 