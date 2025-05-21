import { Ajv, ErrorObject } from 'ajv';
import addFormatsRaw from 'ajv-formats';
import { ApiTool, ErrorResponse } from '@agent-base/types'; // Updated import
import { JSONSchema7 } from 'json-schema';
import { deriveSchemaFromOperation, getOperation } from './utils.js'; // Ensure this import is present

// Initialize AJV
const ajv = new Ajv({ allErrors: true });
(addFormatsRaw as any)(ajv); // Add formats like email, date-time, etc. Cast to any to bypass linter issue

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