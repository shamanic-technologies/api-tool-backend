import Ajv, { ErrorObject } from 'ajv';
// Use require for ajv-formats
const addFormats = require('ajv-formats'); 
import { ExternalUtilityTool, ErrorResponse } from '@agent-base/types';
import type { JSONSchema7 } from 'json-schema';

// Initialize AJV
const ajv = new Ajv({ allErrors: true });
addFormats(ajv); // Add formats like email, date-time, etc.

/**
 * Validates input parameters against the tool's JSON Schema.
 * Assumes config.schema is a standard JSON Schema object with type: 'object'.
 * @param config The tool configuration containing the standard JSON schema.
 * @param params The input parameters to validate.
 * @param logPrefix Logging prefix.
 * @returns An object with validatedParams on success, or an ErrorResponse if validation fails.
 */
export const validateInputParameters = (
    config: ExternalUtilityTool,
    params: Record<string, any>,
    logPrefix: string
): { validatedParams: Record<string, any> } | ErrorResponse => {
    try {
        // Check if schema exists and is the correct basic structure
        if (!config.schema || typeof config.schema !== 'object' || config.schema.type !== 'object' || typeof config.schema.properties !== 'object') {
            // If no valid schema structure is defined, treat validation as passing but log a warning.
            // This might happen for tools that genuinely don't need input parameters.
            console.warn(`${logPrefix} Tool schema is missing, invalid, or has no properties defined. Skipping detailed validation.`);
            // Return the original params, assuming they are okay if no schema is defined.
            return { validatedParams: params || {} }; 
        }

        // The config.schema *is* the schema to validate against.
        // We just need to ensure it's properly passed to AJV.
        // We trust the structure based on the check above and creation validation.
        const schemaToValidate: JSONSchema7 = config.schema;

        // Compile the schema directly
        // AJV expects the schema object directly
        const validate = ajv.compile(schemaToValidate);

        // Perform validation
        if (validate(params)) {
            console.log(`${logPrefix} Input parameters validated successfully against schema.`);
            return { validatedParams: params }; // Validation successful
        } else {
            // Validation failed
            console.error(`${logPrefix} Input parameter validation failed:`, validate.errors);
            const errorDetails = (validate.errors ?? []).map((e: ErrorObject) => ({ 
                // Construct a meaningful path, handling root level errors
                path: e.instancePath ? e.instancePath.substring(1) : (e.keyword === 'required' ? e.params.missingProperty : '/'),
                message: e.message
            }));
            const errorResponse: ErrorResponse = {
                success: false,
                error: 'Input validation failed.',
                details: JSON.stringify(errorDetails)
            };
            return errorResponse;
        }

    } catch (error) {
        // Catch errors during schema compilation or unexpected issues
        console.error(`${logPrefix} Error during AJV validation setup or execution:`, error);
        // Use the specific error message from the catch
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorResponse: ErrorResponse = {
            success: false,
            // Report that the schema itself might be the problem
            error: `Schema validation failed: ${errorMessage}`,
            details: error instanceof Error ? error.stack : undefined
        };
        return errorResponse;
    }
}; 