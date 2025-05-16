import { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import { OpenAPIObject, OperationObject, ParameterObject, ReferenceObject, RequestBodyObject, SchemaObject } from 'openapi3-ts/oas30';

/**
 * Extracts the single operation from the OpenAPI specification.
 * Assumes the spec is pre-validated to contain exactly one path and one method.
 * @param {OpenAPIObject} openapiSpec The OpenAPI specification.
 * @param {string} logPrefix Logging prefix.
 * @returns {OperationObject | null} The operation object or null if not found.
 */
export const getOperation = (openapiSpec: OpenAPIObject, logPrefix: string): OperationObject | null => {
    if (!openapiSpec.paths) {
        console.warn(`${logPrefix} OpenAPI spec is missing 'paths'.`);
        return null;
    }
    const pathKeys = Object.keys(openapiSpec.paths);
    if (pathKeys.length !== 1) {
        console.warn(`${logPrefix} OpenAPI spec 'paths' should contain exactly one path, found ${pathKeys.length}.`);
        return null;
    }
    const pathItem = openapiSpec.paths[pathKeys[0]];
    if (!pathItem) {
        console.warn(`${logPrefix} OpenAPI spec path item for '${pathKeys[0]}' is undefined.`);
        return null;
    }

    const methodKeys = Object.keys(pathItem).filter(key => [
        'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'
    ].includes(key.toLowerCase()));

    if (methodKeys.length !== 1) {
        console.warn(`${logPrefix} OpenAPI spec path item should contain exactly one HTTP method, found ${methodKeys.length}.`);
        return null;
    }
    const operation = pathItem[methodKeys[0] as keyof typeof pathItem] as OperationObject;
    if (!operation || typeof operation !== 'object') {
        console.warn(`${logPrefix} OpenAPI spec operation for '${methodKeys[0]}' is invalid.`);
        return null;
    }
    return operation;
}; 

/**
 * Derives a JSONSchema7 from an OpenAPI OperationObject for validating flat input parameters.
 * @param {OperationObject} operation The OpenAPI Operation Object.
 * @param {OpenAPIObject} openapiSpec The full OpenAPI specification for resolving references.
 * @param {string} logPrefix Logging prefix.
 * @returns {JSONSchema7 | null} The derived JSON schema or null if derivation fails.
 */
export const deriveSchemaFromOperation = (operation: OperationObject, openapiSpec: OpenAPIObject, logPrefix: string): JSONSchema7 | null => {
    const combinedSchema: JSONSchema7 = {
        type: 'object',
        properties: {},
        required: []
    };

    // Helper to resolve $ref - very basic, assumes internal references to #/components/schemas/
    const resolveSchemaRef = (ref: string): SchemaObject | null => {
        if (!ref.startsWith('#/components/schemas/')) {
            console.warn(`${logPrefix} Unsupported $ref format: ${ref}. Only #/components/schemas/ supported.`);
            return null;
        }
        const schemaName = ref.substring('#/components/schemas/'.length);
        const resolved = openapiSpec.components?.schemas?.[schemaName];
        if (!resolved || typeof resolved === 'boolean' || (resolved as ReferenceObject).$ref) { // Check if it's a ReferenceObject itself
            console.warn(`${logPrefix} Failed to resolve $ref or found nested $ref: ${ref}`);
            return null;
        }
        return resolved as SchemaObject;
    };

    // Process server variables from the first server object
    // These are treated as required string parameters for simplicity
    if (openapiSpec.servers && openapiSpec.servers.length > 0) {
        const server = openapiSpec.servers[0];
        if (server.variables) {
            for (const variableName in server.variables) {
                if (combinedSchema.properties && combinedSchema.required) {
                    // Add server variable to schema properties
                    // Defaulting to string type. OpenAPI spec allows for enum and default on server variables.
                    // For now, we'll keep it simple; this could be enhanced.
                    combinedSchema.properties[variableName] = { type: 'string' };
                    // Server variables are implicitly required for the URL to be valid
                    combinedSchema.required.push(variableName);
                    console.log(`${logPrefix} Added server variable '${variableName}' to schema as a required string.`);
                }
            }
        }
    }

    // Process parameters (query, header, path)
    if (operation.parameters) {
        for (const param of operation.parameters) {
            // Resolve parameter if it's a reference
            let parameterObject: ParameterObject;
            if ((param as ReferenceObject).$ref) {
                // Basic reference resolution for parameters - extend if necessary
                const refPath = (param as ReferenceObject).$ref;
                if (refPath.startsWith('#/components/parameters/')) {
                    const paramName = refPath.substring('#/components/parameters/'.length);
                    const resolvedParam = openapiSpec.components?.parameters?.[paramName];
                    if (!resolvedParam || (resolvedParam as ReferenceObject).$ref) {
                        console.warn(`${logPrefix} Failed to resolve parameter $ref or found nested $ref: ${refPath}`);
                        continue;
                    }
                    parameterObject = resolvedParam as ParameterObject;
                } else {
                    console.warn(`${logPrefix} Unsupported parameter $ref: ${refPath}`);
                    continue;
                }
            } else {
                parameterObject = param as ParameterObject;
            }

            if (parameterObject.schema) {
                let paramSchema: JSONSchema7Definition | null = null;
                if ((parameterObject.schema as ReferenceObject).$ref) {
                    paramSchema = resolveSchemaRef((parameterObject.schema as ReferenceObject).$ref) as JSONSchema7Definition | null;
                } else {
                    paramSchema = parameterObject.schema as JSONSchema7Definition;
                }

                if (paramSchema && combinedSchema.properties) {
                    combinedSchema.properties[parameterObject.name] = paramSchema;
                    if (parameterObject.required && combinedSchema.required) {
                        combinedSchema.required.push(parameterObject.name);
                    }
                }
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
                if (!resolvedRb || (resolvedRb as ReferenceObject).$ref) {
                     console.warn(`${logPrefix} Failed to resolve requestBody $ref or found nested $ref: ${refPath}`);
                     return combinedSchema; // Or handle error more gracefully
                }
                requestBodyObject = resolvedRb as RequestBodyObject;
            } else {
                console.warn(`${logPrefix} Unsupported requestBody $ref: ${refPath}`);
                return combinedSchema;
            }
        } else {
            requestBodyObject = operation.requestBody as RequestBodyObject;
        }
        
        // Assuming application/json content type for simplicity
        const mediaType = requestBodyObject.content['application/json'];
        if (mediaType && mediaType.schema) {
            let bodySchema: SchemaObject | null = null;
            if ((mediaType.schema as ReferenceObject).$ref) {
                bodySchema = resolveSchemaRef((mediaType.schema as ReferenceObject).$ref);
            } else {
                bodySchema = mediaType.schema as SchemaObject;
            }

            if (bodySchema && bodySchema.type === 'object' && bodySchema.properties && combinedSchema.properties) {
                for (const key in bodySchema.properties) {
                    const propSchema = bodySchema.properties[key];
                    let finalPropSchema: JSONSchema7Definition | null = null;
                    if((propSchema as ReferenceObject).$ref) {
                        finalPropSchema = resolveSchemaRef((propSchema as ReferenceObject).$ref) as JSONSchema7Definition | null;
                    } else {
                        finalPropSchema = propSchema as JSONSchema7Definition;
                    }
                    if (finalPropSchema) {
                         combinedSchema.properties[key] = finalPropSchema;
                    }
                }
                if (bodySchema.required && Array.isArray(bodySchema.required) && combinedSchema.required) {
                    combinedSchema.required.push(...bodySchema.required);
                }
            }
        }
    }
    
    // If no properties were added, it might mean the tool takes no parameters.
    // In such a case, an empty schema `{type: 'object'}` is appropriate.
    if (Object.keys(combinedSchema.properties || {}).length === 0 && (combinedSchema.required || []).length === 0) {
        // Allow tools with no parameters to pass validation with empty input
        console.log(`${logPrefix} Derived an empty schema; tool likely takes no input parameters or body fields (excluding server variables if any).`);
    }

    return combinedSchema;
};

// --- Credential Key Naming Convention Helpers ---

/**
 * Gets the key used to store/retrieve a simple credential (like an API key or a raw token)
 * in the resolvedSecrets/credentials object, based on its security scheme name.
 * @param {string} schemeName The name of the security scheme (e.g., 'myApiKeyAuth', 'myBearerAuth').
 * @returns {string} The key for the credential object (which is typically the schemeName itself).
 */
export const getCredentialKeyForScheme = (schemeName: string): string => {
    return schemeName;
};

/**
 * Gets the keys used to store/retrieve username and password components for Basic Authentication
 * in the resolvedSecrets/credentials object, based on its security scheme name.
 * @param {string} schemeName The name of the security scheme (e.g., 'basicAuth').
 * @returns {{ username: string, password: string }} An object containing the keys for username and password.
 */
export const getBasicAuthCredentialKeys = (schemeName: string): { username: string, password: string } => {
    return {
        username: `${schemeName}_username`,
        password: `${schemeName}_password`,
    };
};

