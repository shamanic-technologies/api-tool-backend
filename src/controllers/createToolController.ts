import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    ApiTool, 
    UtilityProvider,
    UtilityInputSecret
} from '@agent-base/types'; 
import { OpenAPIObject, SecuritySchemeObject } from 'openapi3-ts/oas30'; // No longer needed for basic validation here
import SwaggerParser from 'swagger-parser'; // Reverted to default import

/**
 * Validates the OpenAPI specification object using swagger-parser and checks custom conventions.
 * @param openapiSpec The OpenAPI specification object (as any, to be validated by the parser).
 * @returns {Promise<string[]>} An array of validation error messages, empty if valid.
 */
const validateOpenApiStructureWithLib = async (openapiSpec: OpenAPIObject): Promise<string[]> => {
    const errors: string[] = [];
    try {
        // Using type assertion as a temporary measure due to persistent linter errors
        // This assumes that SwaggerParser.validate() is the correct JavaScript call as per library docs.
        await (SwaggerParser as any).validate(openapiSpec); 

        // --- Custom Shamanic/Agent-Base Convention Checks ---
        // These checks are specific to how api-tool-backend expects to use the OpenAPI spec for a single tool.
        // A generally valid OpenAPI spec might still not meet these conventions.

        if (!openapiSpec.openapi || !openapiSpec.openapi.startsWith('3.')) {
            // This basic check might be redundant if SwaggerParser.validate already covers it, 
            // but explicit check doesn't hurt as a pre-condition for custom logic.
            errors.push('openapiSpecification must be a valid OpenAPI 3.x document (missing/invalid openapi version string).');
        }
        if (!openapiSpec.info || typeof openapiSpec.info !== 'object' || !openapiSpec.info.title || !openapiSpec.info.version) {
            errors.push('openapiSpecification must have an info object with at least title and version.');
        }

        if (!openapiSpec.paths || typeof openapiSpec.paths !== 'object' || Object.keys(openapiSpec.paths).length === 0) {
            errors.push('openapiSpecification must have a paths object with at least one path defined.');
        } else {
            const pathKeys = Object.keys(openapiSpec.paths);
            if (pathKeys.length !== 1) {
                errors.push(`openapiSpecification.paths must contain exactly one path definition for this tool (found ${pathKeys.length}).`);
            }
            const pathItem = openapiSpec.paths[pathKeys[0]]; 
            if (pathItem) {
                const methodKeys = Object.keys(pathItem).filter(key => [
                    'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'
                ].includes(key.toLowerCase()));
                if (methodKeys.length !== 1) {
                    errors.push(`The path item in openapiSpecification.paths must contain exactly one HTTP method definition for this tool (found ${methodKeys.length}).`);
                }
            }
        }

        // --- Add this new custom check for 'servers' ---
        if (!openapiSpec.servers || !Array.isArray(openapiSpec.servers) || openapiSpec.servers.length === 0) {
            errors.push('openapiSpecification must have a non-empty "servers" array defining the base URL(s) for the API.');
        } else {
            // Enforce that there is exactly one server object
            if (openapiSpec.servers.length !== 1) {
                errors.push(`openapiSpecification.servers must contain exactly one server object for this tool (found ${openapiSpec.servers.length}).`);
            }
            // These checks proceed only if the length is one, or will report issues on the first element if length > 1 (though the above error is more primary)
            const firstServer = openapiSpec.servers[0]; 
            if (!firstServer.url) {
                errors.push('The first server object in "servers" array must have a "url" property.');
            } else if (firstServer.url === '/') {
                 errors.push('The server URL "/" is a default and likely insufficient. Please provide a full base URL (e.g., https://api.example.com).');
            }
            // You could add more sophisticated checks, like ensuring the URL is absolute if needed.
        }


    } catch (err: any) {
        let errorMessage = 'OpenAPI Specification validation failed.';
        if (err && err.message) {
            // err.message from swagger-parser can be quite detailed, sometimes multi-line or with structure.
            errorMessage = err.message;
        } else if (err && err.details && Array.isArray(err.details)) {
            errorMessage = err.details.map((detail: any) => detail.message || JSON.stringify(detail)).join('; ');
        } else if (typeof err === 'string') {
            errorMessage = err;
        }
        // Add a generic prefix, but the detailed message from the library is usually more helpful.
        errors.push(`OpenAPI Spec Error: ${errorMessage.replace(/\n/g, ' ')}`); // Replace newlines for single line error entry
    }
    return errors;
};

/**
 * Controller to create a new API tool configuration.
 * Expects an ApiTool object in the request body with the new structure.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const createTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[API Tool Service] Attempting to create tool with new structure');
    try {
        const newApiTool: ApiTool = req.body;
        const validationErrors: string[] = [];

        if (!newApiTool) {
            validationErrors.push('Request body is empty.');
        } else {
            // Normalize utilityProvider
            if (newApiTool.hasOwnProperty('utilityProvider')) {
                if (typeof newApiTool.utilityProvider === 'string' && newApiTool.utilityProvider.trim() !== '') {
                    newApiTool.utilityProvider = newApiTool.utilityProvider.toLowerCase() as UtilityProvider;
                } else if (typeof newApiTool.utilityProvider !== 'string') {
                    validationErrors.push('utilityProvider field must be a non-empty string.');
                } else {
                    validationErrors.push('Missing required field: utilityProvider (cannot be empty).');
                }
            } else {
                 validationErrors.push('Missing required field: utilityProvider.');
            }

            // Normalize securitySecrets values to lowercase and validate against UtilityInputSecret
            if (newApiTool.securitySecrets && typeof newApiTool.securitySecrets === 'object') {
                const secretKeys: Array<keyof ApiTool['securitySecrets']> = ["x-secret-name", "x-secret-username", "x-secret-password"];
                const validSecretEnumValues = Object.values(UtilityInputSecret) as string[]; 

                for (const key of secretKeys) {
                    const secretValue = newApiTool.securitySecrets[key];
                    if (secretValue && typeof secretValue === 'string') {
                        const lowercasedSecretValue = secretValue.toLowerCase();
                        newApiTool.securitySecrets[key] = lowercasedSecretValue as UtilityInputSecret;
                        if (!validSecretEnumValues.includes(lowercasedSecretValue)) {
                            validationErrors.push(
                                `Invalid value for securitySecrets.${key}: '${secretValue}'. Must be one of [${validSecretEnumValues.join(", ")}] (e.g., 'api_secret_key', 'username', 'password'). Check UtilityInputSecret enum.`
                            );
                        }
                    } else if (secretValue && typeof secretValue !== 'string') {
                        validationErrors.push(`Value for securitySecrets.${key} must be a string if provided.`);
                    } 
                }
            }

            // Basic presence and structural validations
            if (!newApiTool.id) validationErrors.push('Missing required field: id');
            if (!newApiTool.utilityProvider && !validationErrors.some(err => err.includes('utilityProvider'))) {
                 validationErrors.push('Missing required field: utilityProvider.');
            }
            
            if (!newApiTool.openapiSpecification) {
                validationErrors.push('Missing required field: openapiSpecification');
            } else {
                // Call the new validation function
                const openApiErrors = await validateOpenApiStructureWithLib(newApiTool.openapiSpecification);
                validationErrors.push(...openApiErrors);
            }

            // securityOption and securitySecrets validation (dependent on openapiSpecification being valid enough to check against)
            // This block should ideally run only if openApiErrors from above is empty.
            if (validationErrors.filter(e => e.startsWith('OpenAPI Spec Error:')).length === 0 && newApiTool.openapiSpecification) {
                if (!newApiTool.securityOption || typeof newApiTool.securityOption !== 'string') {
                    validationErrors.push('Missing or invalid required field: securityOption (must be a string).');
                } else if (newApiTool.openapiSpecification.components?.securitySchemes) {
                    if (!newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption]) {
                        validationErrors.push(`securityOption '${newApiTool.securityOption}' does not match any key in openapiSpecification.components.securitySchemes.`);
                    }
                } else {
                     validationErrors.push('openapiSpecification.components.securitySchemes is missing, cannot validate securityOption.');
                }

                if (!newApiTool.securitySecrets || typeof newApiTool.securitySecrets !== 'object') {
                    validationErrors.push('Missing or invalid required field: securitySecrets (must be an object).');
                } else if (newApiTool.openapiSpecification.components?.securitySchemes && 
                           newApiTool.securityOption && 
                           newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption] &&
                           !('$ref' in newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption])) { // Ensure not a $ref before casting
                    
                    const chosenScheme = newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption] as import('openapi3-ts/oas30').SecuritySchemeObject;
                    const secretsProvided = newApiTool.securitySecrets;

                    switch (chosenScheme.type) {
                        case 'apiKey':
                            if (!secretsProvided["x-secret-name"]) {
                                validationErrors.push(`For apiKey securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-name'.`);
                            }
                            // Fields x-secret-username and x-secret-password are not used for apiKey, so we don't need to check if they are absent here,
                            // as their presence isn't strictly an error unless they contained invalid UtilityInputSecret values (already checked).
                            break;
                        case 'http':
                            if (chosenScheme.scheme === 'bearer') {
                                if (!secretsProvided["x-secret-name"]) {
                                    validationErrors.push(`For HTTP Bearer securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-name'.`);
                                } 
                            } else if (chosenScheme.scheme === 'basic') {
                                if (!secretsProvided["x-secret-username"]) {
                                    validationErrors.push(`For HTTP Basic securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-username'.`);
                                } 
                                // x-secret-password for basic is optional (implies empty if not provided or if its value is an empty string mapped to a UtilityInputSecret type)
                                // x-secret-name should not be present for basic.
                                if (secretsProvided["x-secret-name"]) {
                                    validationErrors.push(`For HTTP Basic securityOption '${newApiTool.securityOption}', securitySecrets should NOT define 'x-secret-name'.`);
                                }
                            } else {
                                validationErrors.push(`Unsupported HTTP scheme '${chosenScheme.scheme}' for securityOption '${newApiTool.securityOption}'.`);
                        }
                            break;
                        default:
                            validationErrors.push(`Unsupported security scheme type '${chosenScheme.type}' for securityOption '${newApiTool.securityOption}'.`);
                    }
                }
            }
        }

        if (validationErrors.length > 0) {
            console.warn(`[API Tool Service] Tool creation validation failed:`, validationErrors);
            res.status(400).json({ 
                success: false, 
                error: 'Invalid tool configuration provided.',
                details: validationErrors
            });
            return;
        }

        console.log(`[API Tool Service] Creating tool with ID: ${newApiTool.id}`);
        const createdTool = await utilityService.addNewTool(newApiTool);
        res.status(201).json({ 
            success: true, 
            data: createdTool,
            hint: `Now execute the tool using the execute_api_tool utility.`
        });

    } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ success: false, error: error.message });
        } else {
            console.error('Error creating tool:', error);
            next(error);
        }
    }
}; 