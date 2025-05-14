import Ajv, { ErrorObject } from 'ajv';
// Use require for ajv-formats as it's a common pattern for CJS modules in ESM
const addFormats = require('ajv-formats'); 
import { ApiTool, ErrorResponse } from '@agent-base/types'; // Updated import
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema';
import { OpenAPIObject, OperationObject, ParameterObject, RequestBodyObject, SchemaObject, ReferenceObject } from 'openapi3-ts/oas30';
import { getOperation } from './utils'; // Ensure this import is present

// Initialize AJV
const ajv = new Ajv({ allErrors: true });
addFormats(ajv); // Add formats like email, date-time, etc.

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
        console.log(`${logPrefix} Derived an empty schema; tool likely takes no input parameters or body fields.`);
    }

    return combinedSchema;
};


/**
 * Validates input parameters against a schema derived from the ApiTool's OpenAPI specification.
 * @param {ApiTool} apiTool The API tool configuration containing the OpenAPI specification.
 * @param {Record<string, any>} params The input parameters to validate.
 * @param {string} logPrefix Logging prefix.
 * @returns An object with validatedParams on success, or an ErrorResponse if validation fails.
 */
export const validateInputParameters = (
    apiTool: ApiTool, // Updated parameter type
    params: Record<string, any>,
    logPrefix: string
): { validatedParams: Record<string, any> } | ErrorResponse => {
    try {
        // Corrected logic: First get operation, then derive schema
        const operation = getOperation(apiTool.openapiSpecification, logPrefix);
        if (!operation) {
            console.error(`${logPrefix} Could not extract a single operation from ApiTool openapiSpecification.`);
            return {
                success: false,
                error: 'Invalid ApiTool: Could not determine operation from OpenAPI specification.',
                details: 'The openapiSpecification in the ApiTool must define exactly one path with one HTTP method.'
            };
        }

        const schemaToValidate = deriveSchemaFromOperation(operation, apiTool.openapiSpecification, logPrefix);

        if (!schemaToValidate) {
            console.error(`${logPrefix} Failed to derive a JSON schema from the OpenAPI operation.`);
            return {
                success: false,
                error: 'Schema Derivation Failed: Could not create validation schema from OpenAPI specification.',
                details: 'Review OpenAPI structure, especially $refs and parameter/requestBody definitions.'
            };
        }
        
        if (Object.keys(schemaToValidate.properties || {}).length === 0 && (!params || Object.keys(params).length === 0)) {
            console.log(`${logPrefix} Tool takes no parameters or empty params provided for no-parameter tool. Validation passed.`);
            return { validatedParams: {} };
        }

        const validate = ajv.compile(schemaToValidate);

        if (validate(params)) {
            console.log(`${logPrefix} Input parameters validated successfully against derived schema.`);
            return { validatedParams: params };
        } else {
            console.error(`${logPrefix} Input parameter validation failed against derived schema:`, validate.errors);
            const errorDetails = (validate.errors ?? []).map((e: ErrorObject) => ({ 
                path: e.instancePath ? e.instancePath.substring(1) : (e.keyword === 'required' ? e.params.missingProperty : '/'),
                message: e.message
            }));
            return {
                success: false,
                error: 'Input validation failed.',
                details: JSON.stringify(errorDetails)
            };
        }

    } catch (error) {
        console.error(`${logPrefix} Error during AJV validation or schema derivation:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Schema validation process failed: ${errorMessage}`,
            details: error instanceof Error ? error.stack : undefined
        };
    }
}; 