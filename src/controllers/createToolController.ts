import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    UtilityProvider,
    UtilityInputSecret,
    // ApiTool, // No longer directly used as input type for addNewTool
} from '@agent-base/types'; 
import { OpenAPIObject } from 'openapi3-ts/oas30'; 
import SwaggerParser from 'swagger-parser';

/**
 * Validates the OpenAPI specification object using swagger-parser and checks custom conventions.
 * @param openapiSpec The OpenAPI specification object.
 * @returns {Promise<string[]>} An array of validation error messages, empty if valid.
 */
const validateOpenApiStructureWithLib = async (openapiSpec: OpenAPIObject): Promise<string[]> => {
    const errors: string[] = [];
    try {
        await (SwaggerParser as any).validate(openapiSpec); 

        if (!openapiSpec.openapi || !openapiSpec.openapi.startsWith('3.')) {
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

        if (!openapiSpec.servers || !Array.isArray(openapiSpec.servers) || openapiSpec.servers.length === 0) {
            errors.push('openapiSpecification must have a non-empty "servers" array defining the base URL(s) for the API.');
        } else {
            if (openapiSpec.servers.length !== 1) {
                errors.push(`openapiSpecification.servers must contain exactly one server object for this tool (found ${openapiSpec.servers.length}).`);
            }
            const firstServer = openapiSpec.servers[0]; 
            if (!firstServer.url) {
                errors.push('The first server object in "servers" array must have a "url" property.');
            } else if (firstServer.url === '/') {
                 errors.push('The server URL "/" is a default and likely insufficient. Please provide a full base URL (e.g., https://api.example.com).');
            }
        }
    } catch (err: any) {
        let errorMessage = 'OpenAPI Specification validation failed.';
        if (err && err.message) {
            errorMessage = err.message;
        } else if (err && err.details && Array.isArray(err.details)) {
            errorMessage = err.details.map((detail: any) => detail.message || JSON.stringify(detail)).join('; ');
        } else if (typeof err === 'string') {
            errorMessage = err;
        }
        errors.push(`OpenAPI Spec Error: ${errorMessage.replace(/\n/g, ' ')}`);
    }
    return errors;
};

/**
 * Controller to create a new API tool configuration.
 * @param {Request} req Express request object, body should conform to structure expected for CreateApiToolData.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const createTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[API Tool Service] Attempting to create tool');
    try {
        const requestBody = req.body;
        const validationErrors: string[] = [];

        if (!requestBody) {
            validationErrors.push('Request body is empty.');
            res.status(400).json({ success: false, error: 'Request body is empty.', details: validationErrors });
            return;
        }

        // --- Field Extraction and Basic Validation for CreateApiToolData fields ---
        let validatedUtilityProvider: UtilityProvider | undefined;
        if (requestBody.hasOwnProperty('utilityProvider')) {
            if (typeof requestBody.utilityProvider === 'string' && requestBody.utilityProvider.trim() !== '') {
                validatedUtilityProvider = requestBody.utilityProvider.toLowerCase() as UtilityProvider;
            } else {
                validationErrors.push('utilityProvider field must be a non-empty string.');
            }
        } else {
             validationErrors.push('Missing required field: utilityProvider.');
        }

        let validatedCreatorUserId: string | undefined;
        if (requestBody.hasOwnProperty('creatorUserId')) {
            if (typeof requestBody.creatorUserId === 'string' && requestBody.creatorUserId.trim() !== '') {
                validatedCreatorUserId = requestBody.creatorUserId;
            } else {
                validationErrors.push('creatorUserId field must be a non-empty string.');
            }
        } else {
            validationErrors.push('Missing required field: creatorUserId.');
        }
        
        // ID should not be provided by the client
        if (requestBody.hasOwnProperty('id')) {
            validationErrors.push("Field 'id' should not be provided; it will be auto-generated.");
        }

        const normalizedSecuritySecrets: any = {}; // Initialize as an empty object
        if (requestBody.securitySecrets && typeof requestBody.securitySecrets === 'object') {
            // Explicitly type secretKeys as a union of known string literals
            const secretKeys: ("x-secret-name" | "x-secret-username" | "x-secret-password")[] = ["x-secret-name", "x-secret-username", "x-secret-password"];
            const validSecretEnumValues = Object.values(UtilityInputSecret) as string[]; 

            for (const key of secretKeys) { // key is now of type "x-secret-name" | "x-secret-username" | "x-secret-password"
                const secretValue = requestBody.securitySecrets[key]; 
                if (secretValue !== undefined && secretValue !== null) { 
                    if (typeof secretValue === 'string') {
                        const lowercasedSecretValue = secretValue.toLowerCase();
                        normalizedSecuritySecrets[key] = lowercasedSecretValue as UtilityInputSecret;
                        if (!validSecretEnumValues.includes(lowercasedSecretValue)) {
                            validationErrors.push(
                                `Invalid value for securitySecrets.${key}: '${secretValue}'. Must be one of [${validSecretEnumValues.join(", ")}] (e.g., 'api_secret_key', 'username', 'password'). Check UtilityInputSecret enum.`
                            );
                        }
                    } else {
                        validationErrors.push(`Value for securitySecrets.${key} must be a string.`);
                    } 
                }
            }
        } else {
            validationErrors.push('Missing or invalid required field: securitySecrets (must be an object).');
        }
        
        if (!requestBody.openapiSpecification) {
            validationErrors.push('Missing required field: openapiSpecification');
        } else {
            const openApiErrors = await validateOpenApiStructureWithLib(requestBody.openapiSpecification);
            validationErrors.push(...openApiErrors);
        }

        if (validationErrors.filter(e => e.startsWith('OpenAPI Spec Error:')).length === 0 && requestBody.openapiSpecification) {
            if (!requestBody.securityOption || typeof requestBody.securityOption !== 'string' || requestBody.securityOption.trim() === '') {
                validationErrors.push('Missing or invalid required field: securityOption (must be a non-empty string).');
            } else if (requestBody.openapiSpecification.components?.securitySchemes) {
                if (!requestBody.openapiSpecification.components.securitySchemes[requestBody.securityOption]) {
                    validationErrors.push(`securityOption '${requestBody.securityOption}' does not match any key in openapiSpecification.components.securitySchemes.`);
                }
            } else {
                 validationErrors.push('openapiSpecification.components.securitySchemes is missing, cannot validate securityOption.');
            }

            // Validate securitySecrets content based on chosen securityOption (after basic structure check of securitySecrets object)
            if (typeof requestBody.securitySecrets === 'object' && 
                requestBody.openapiSpecification.components?.securitySchemes && 
                requestBody.securityOption && 
                requestBody.openapiSpecification.components.securitySchemes[requestBody.securityOption] &&
                !(requestBody.openapiSpecification.components.securitySchemes[requestBody.securityOption] as any).$ref) {
                
                const chosenScheme = requestBody.openapiSpecification.components.securitySchemes[requestBody.securityOption] as import('openapi3-ts/oas30').SecuritySchemeObject;
                // Use normalizedSecuritySecrets for checking required fields
                switch (chosenScheme.type) {
                    case 'apiKey':
                        if (!normalizedSecuritySecrets["x-secret-name"]) {
                            validationErrors.push(`For apiKey securityOption '${requestBody.securityOption}', securitySecrets must define 'x-secret-name'.`);
                        }
                        break;
                    case 'http':
                        if (chosenScheme.scheme === 'bearer') {
                            if (!normalizedSecuritySecrets["x-secret-name"]) {
                                validationErrors.push(`For HTTP Bearer securityOption '${requestBody.securityOption}', securitySecrets must define 'x-secret-name'.`);
                            } 
                        } else if (chosenScheme.scheme === 'basic') {
                            if (!normalizedSecuritySecrets["x-secret-username"]) {
                                validationErrors.push(`For HTTP Basic securityOption '${requestBody.securityOption}', securitySecrets must define 'x-secret-username'.`);
                            } 
                            if (normalizedSecuritySecrets["x-secret-name"]) {
                                validationErrors.push(`For HTTP Basic securityOption '${requestBody.securityOption}', securitySecrets should NOT define 'x-secret-name'.`);
                            }
                        } else {
                            validationErrors.push(`Unsupported HTTP scheme '${chosenScheme.scheme}' for securityOption '${requestBody.securityOption}'.`);
                        }
                        break;
                    default:
                        validationErrors.push(`Unsupported security scheme type '${chosenScheme.type}' for securityOption '${requestBody.securityOption}'.`);
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

        // Construct CreateApiToolData if all validations pass
        const toolCreationData: utilityService.CreateApiToolData = {
            utilityProvider: validatedUtilityProvider!, 
            openapiSpecification: requestBody.openapiSpecification,
            securityOption: requestBody.securityOption,
            securitySecrets: normalizedSecuritySecrets, 
            isVerified: requestBody.isVerified === undefined ? false : !!requestBody.isVerified,
            creatorUserId: validatedCreatorUserId!, 
        };
        
        console.log(`[API Tool Service] Creating tool for user: ${toolCreationData.creatorUserId}`);
        const createdTool = await utilityService.addNewTool(toolCreationData);
        
        res.status(201).json({ 
            success: true, 
            data: createdTool,
            hint: `Now execute the tool using the execute_api_tool utility.`
        });

    } catch (error) {
        if (error instanceof Error) {
            // Check for specific error messages if applicable, e.g., from unique constraints from DB
           if (error.message.includes("unique constraint") || error.message.includes("violates unique constraint") || error.message.includes("already exists")) {
                res.status(409).json({ success: false, error: "A tool with similar identifying characteristics already exists." , details: error.message});
           } else if (error.message.startsWith('Failed to add new tool: Could not create API tool.') || error.message.includes('Could not create API tool')) {
                // This is likely a DB operational error from createApiTool in databaseService
                res.status(500).json({ success: false, error: "Failed to save tool to database.", details: error.message });
           } else {
                // Other errors from addNewTool service logic or unexpected issues
                res.status(500).json({ success: false, error: `Failed to create tool: ${error.message}` });
           }
       } else {
           console.error('Error creating tool (unknown type):', error);
           next(error); // Fallback to generic error handler
       }
    }
}; 