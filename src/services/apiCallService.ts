import axios, { AxiosRequestConfig, Method } from 'axios';
import { Buffer } from 'buffer';
import { ApiTool, ServiceResponse,  } from '@agent-base/types';
// @ts-ignore - For some reason, ApiToolExecutionResult is not recognized in the types package
import { ApiToolExecutionResult } from '@agent-base/types';
import { 
    ParameterObject, 
    OperationObject,
    RequestBodyObject, 
    SchemaObject, 
    ReferenceObject,
    SecuritySchemeObject
} from 'openapi3-ts/oas30';
import { getOperation, getCredentialKeyForScheme, getBasicAuthCredentialKeys } from './utils.js'; // Assuming getOperation is in a shared utils.ts and added credential key helpers

/**
 * Makes an API call based on the ApiTool's OpenAPI specification.
 * @param {ApiTool} apiTool The API tool configuration with OpenAPI spec.
 * @param {Record<string, any>} validatedParams The validated input parameters (flat structure).
 * @param {Record<string, string | null>} credentials Fetched credentials (API keys, tokens), keyed by security scheme name or derived name.
 * @param {string} logPrefix Logging prefix.
 * @returns {Promise<any>} The data from the API response.
 * @throws Throws an error if the API call fails or the spec is insufficient.
 */
export const makeApiCall = async (
    apiTool: ApiTool, 
    validatedParams: Record<string, any>,
    credentials: Record<string, string | null>, 
    logPrefix: string
): Promise<ServiceResponse<ApiToolExecutionResult>> => {
    const openapiSpec = apiTool.openapiSpecification;
    const operation : OperationObject | null = getOperation(openapiSpec, logPrefix);

    if (!operation) {
        console.error(`${logPrefix} Could not determine operation from OpenAPI spec.`);
        throw new Error(`${logPrefix} Could not determine operation from OpenAPI spec.`);
    }

    // Determine HTTP Method (e.g., 'get', 'post')
    // This requires finding which key in the PathItemObject corresponds to the operation.
    // We assume getOperation is robust or this was pre-validated.
    let httpMethod: string = '';
    const pathItemObject = openapiSpec.paths[Object.keys(openapiSpec.paths)[0]]; // Assuming single path
    for (const m of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
        if (pathItemObject[m as keyof typeof pathItemObject] === operation) {
            httpMethod = m;
            break;
        }
    }

    if (!httpMethod) {
        console.error(`${logPrefix} Could not determine HTTP method for the operation.`);
        throw new Error(`${logPrefix} Could not determine HTTP method for the operation.`);
    }

    // Determine Base URL from servers object (use the first one if multiple)
    let baseUrl = '';
    if (openapiSpec.servers && openapiSpec.servers.length > 0) {
        // TODO: Handle server variables if present in openapiSpec.servers[0].variables
        baseUrl = openapiSpec.servers[0].url;

        // Resolve server variables in the baseUrl
        const serverObject = openapiSpec.servers[0];
        if (serverObject.variables) {
            for (const variableName in serverObject.variables) {
                if (validatedParams.hasOwnProperty(variableName)) {
                    const value = String(validatedParams[variableName]);
                    // OpenAPI server variable placeholders are like {variableName}
                    const placeholder = `{${variableName}}`;
                    baseUrl = baseUrl.replace(placeholder, encodeURIComponent(value));
                    console.log(`${logPrefix} Replaced server variable '${placeholder}' with '${encodeURIComponent(value)}' in baseUrl.`);
                } else {
                    // This case should ideally be caught by validationService if server variables are made required.
                    // However, if a variable has a default in OpenAPI spec and is not provided, we might use the default.
                    // For now, we assume validation has ensured required server variables are present.
                    const defaultValue = serverObject.variables[variableName].default;
                    if (defaultValue) {
                        const placeholder = `{${variableName}}`;
                        baseUrl = baseUrl.replace(placeholder, encodeURIComponent(defaultValue));
                         console.log(`${logPrefix} Replaced server variable '${placeholder}' with default value '${encodeURIComponent(defaultValue)}' in baseUrl.`);
                    } else {
                        // If no default and not in params, this could be an issue.
                        console.error(`${logPrefix} Server variable '${variableName}' not found in validatedParams and has no default value.`);
                        // Depending on strictness, could throw an error here.
                        // throw new Error(`${logPrefix} Server variable '${variableName}' is required but not provided and has no default.`);
                    }
                }
            }
        }
    } else {
        // Fallback or error if no server is defined - this should be validated upfront ideally
        console.error(`${logPrefix} No servers defined in OpenAPI spec. Attempting to proceed without a base URL.`);
        // throw new Error(`${logPrefix} No servers defined in OpenAPI spec.`);
    }

    // Path (template)
    const pathTemplate = Object.keys(openapiSpec.paths)[0]; // Assuming single path

    const headers: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    let finalUrl = baseUrl + pathTemplate;
    let requestBodyForCall: any = undefined;

    // Process parameters (path, query, header)
    if (operation.parameters) {
        for (const param of operation.parameters) {
            let parameterObject: ParameterObject;
            if ((param as ReferenceObject).$ref) {
                // Basic $ref resolution for parameters (components/parameters)
                const refPath = (param as ReferenceObject).$ref;
                if (refPath.startsWith('#/components/parameters/')) {
                    const paramName = refPath.substring('#/components/parameters/'.length);
                    const resolvedParam = openapiSpec.components?.parameters?.[paramName];
                    if (!resolvedParam || (resolvedParam as ReferenceObject).$ref) { /* error or skip */ continue; }
                    parameterObject = resolvedParam as ParameterObject;
                } else { /* error or skip */ continue; }
            } else {
                parameterObject = param as ParameterObject;
            }

            const paramValue = validatedParams[parameterObject.name];
            if (paramValue === undefined && parameterObject.required) {
                throw new Error(`${logPrefix} Missing required parameter: ${parameterObject.name}`);
            }
            if (paramValue === undefined) continue;

            switch (parameterObject.in) {
                case 'path':
                    finalUrl = finalUrl.replace(`{${parameterObject.name}}`, encodeURIComponent(String(paramValue)));
                    break;
                case 'query':
                    // TODO: Handle complex serialization (style, explode) if necessary. Axios handles simple cases.
                    queryParams[parameterObject.name] = String(paramValue);
                    break;
                case 'header':
                    headers[parameterObject.name] = String(paramValue);
                    break;
                // 'cookie' parameters are less common for server-to-server, skipping for now.
            }
        }
    }

    // Process requestBody
    if (operation.requestBody) {
        let requestBodyObject: RequestBodyObject;
        if ((operation.requestBody as ReferenceObject).$ref) {
            const refPath = (operation.requestBody as ReferenceObject).$ref;
             if (refPath.startsWith('#/components/requestBodies/')) {
                const rbName = refPath.substring('#/components/requestBodies/'.length);
                const resolvedRb = openapiSpec.components?.requestBodies?.[rbName];
                if (!resolvedRb || (resolvedRb as ReferenceObject).$ref) {throw new Error("Invalid ref for req body");}
                requestBodyObject = resolvedRb as RequestBodyObject;
            } else { throw new Error("Invalid ref for req body"); }
                } else {
            requestBodyObject = operation.requestBody as RequestBodyObject;
        }

        // Assume application/json, or the first one defined.
        // More robust logic would check available content types.
        const contentType = Object.keys(requestBodyObject.content)[0] || 'application/json';
        headers['Content-Type'] = contentType;

        const mediaTypeObject = requestBodyObject.content[contentType];
        if (mediaTypeObject && mediaTypeObject.schema) {
            // Construct the actual request body based on validatedParams and the schema
            // If schema is {type: object, properties: {...}}, filter validatedParams to include only these properties
            let schemaForBody = mediaTypeObject.schema;
            if((schemaForBody as ReferenceObject).$ref){
                const refPath = (schemaForBody as ReferenceObject).$ref;
                if (refPath.startsWith('#/components/schemas/')) {
                    const schemaName = refPath.substring('#/components/schemas/'.length);
                    const resolvedSchema = openapiSpec.components?.schemas?.[schemaName];
                    if (!resolvedSchema || (resolvedSchema as ReferenceObject).$ref) { /* error */ throw new Error("Invalid schema ref");}
                    schemaForBody = resolvedSchema as SchemaObject;
                } else { /* error */ throw new Error("Invalid schema ref path"); }
            }

            if ((schemaForBody as SchemaObject).type === 'object' && (schemaForBody as SchemaObject).properties) {
                requestBodyForCall = {};
                for (const propName in (schemaForBody as SchemaObject).properties) {
                    if (validatedParams.hasOwnProperty(propName)) {
                        requestBodyForCall[propName] = validatedParams[propName];
                    }
                }
            } else {
                // If schema is not an object or has no properties (e.g. direct scalar, array, or any type)
                // This part might need refinement based on how such body schemas are represented in validatedParams.
                // For now, we assume if it's not an object with properties, validatedParams itself might be the body
                // if it matches the schema type, or a specific key in validatedParams holds the body.
                // This is a simplification; a more robust solution handles various schema types for direct body.
                requestBodyForCall = validatedParams; // This is a broad assumption!
            }
        }
    }

    // Apply Authentication from credentials
    const securityRequirements = operation.security && operation.security.length > 0 ? operation.security[0] : {};
    for (const schemeName in securityRequirements) {
        const securitySchemeRef = openapiSpec.components?.securitySchemes?.[schemeName];
        if (!securitySchemeRef) continue;

        let securityScheme: SecuritySchemeObject;
        if((securitySchemeRef as ReferenceObject).$ref){
             const refPath = (securitySchemeRef as ReferenceObject).$ref;
             if (refPath.startsWith('#/components/securitySchemes/')) {
                const actualSchemeName = refPath.substring('#/components/securitySchemes/'.length);
                const resolvedScheme = openapiSpec.components?.securitySchemes?.[actualSchemeName];
                if (!resolvedScheme || (resolvedScheme as ReferenceObject).$ref) continue;
                securityScheme = resolvedScheme as SecuritySchemeObject;
            } else continue;
        } else {
            securityScheme = securitySchemeRef as SecuritySchemeObject;
        }

        // Use helpers to get standardized credential keys
        const basicAuthKeys = getBasicAuthCredentialKeys(schemeName);
        const singleCredKey = getCredentialKeyForScheme(schemeName);

        const credentialValue = credentials[singleCredKey]; // For API Key, Bearer (raw token/key)
        const username = credentials[basicAuthKeys.username];    // For Basic Auth username
        const password = credentials[basicAuthKeys.password];    // For Basic Auth password

        switch (securityScheme.type) {
            case 'apiKey':
                if (credentialValue) { // credentialValue is the raw API key
                    if (!securityScheme.name) {
                        console.error(`${logPrefix} API key security scheme '${schemeName}' is missing required 'name' property.`);
                        break;
                    }
                    if (securityScheme.in === 'header') {
                        headers[securityScheme.name] = credentialValue;
                    } else if (securityScheme.in === 'query') {
                        queryParams[securityScheme.name] = credentialValue;
                    } 
                }
                break;
            case 'http':
                if (securityScheme.scheme?.toLowerCase() === 'bearer' && credentialValue) { // credentialValue is the raw token
                    headers['Authorization'] = `Bearer ${credentialValue}`;
                }
                if (securityScheme.scheme?.toLowerCase() === 'basic' && username) { // username is raw username
                    const effectivePassword = password || ""; 
                    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${effectivePassword}`).toString('base64')}`;
                }
                break;
            case 'oauth2':
                if (credentialValue) { // credentialValue is the raw access token
                    headers['Authorization'] = `Bearer ${credentialValue}`;
                }
                break;
            // OpenIDConnect also not handled here for brevity.
        }
    }

    if(Object.keys(headers).length > 0) console.log(`${logPrefix} Headers:`, JSON.stringify(headers));
    if(Object.keys(queryParams).length > 0) console.log(`${logPrefix} Query Params:`, JSON.stringify(queryParams));
    if(requestBodyForCall !== undefined) console.log(`${logPrefix} Body:`, JSON.stringify(requestBodyForCall));

    const requestConfig: AxiosRequestConfig = {
        method: httpMethod as Method,
        url: finalUrl,
        headers: {
            'Accept': 'application/json',
            ...headers,
        },
        params: queryParams,
        data: requestBodyForCall,
    };

    try {
        const response = await axios(requestConfig);
        const apiCallResponse : ApiToolExecutionResult = {
            success: true,
            data: response.data,
        };
        return apiCallResponse as ServiceResponse<ApiToolExecutionResult>;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error(`${logPrefix} Axios error making API call: Status ${error.response?.status}, URL: ${error.config?.url}, Response Data:`, error.response?.data);
        }
        throw error; // Re-throw to be handled by handleExecution
    }
}; 