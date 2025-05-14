import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    ApiTool, 
    ApiToolInfo, 
    // ExecuteToolPayload, // Review if this payload structure is still optimal or if direct params are fine
    AgentServiceCredentials, 
    ApiToolExecutionResponse, 
    ErrorResponse, 
    SuccessResponse, 
    UtilitySecretType,
    UtilityProvider
    // NO SecuritySchemeObject import from @agent-base/types
} from '@agent-base/types'; 
import { getAuthHeadersFromAgent } from '@agent-base/api-client';
// SecuritySchemeObject is imported ONLY from openapi3-ts/oas30
import { OpenAPIObject, SecuritySchemeObject } from 'openapi3-ts/oas30'; // For validating openapiSpecification structure

// Assuming ExecuteToolPayload might be defined like this or passed flatly
interface ExecuteToolPayload {
    conversationId: string;
    params: Record<string, any>;
}

/**
 * Validates the basic structure of an OpenAPIObject, focusing on the single path/operation convention.
 * @param openapiSpec The OpenAPI specification object.
 * @returns {string[]} An array of validation error messages, empty if valid.
 */
const validateOpenApiStructure = (openapiSpec: OpenAPIObject): string[] => {
    const errors: string[] = [];
    if (!openapiSpec || typeof openapiSpec !== 'object') {
        errors.push('openapiSpecification is missing or not an object.');
        return errors;
    }
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
            errors.push(`openapiSpecification.paths must contain exactly one path definition (found ${pathKeys.length}).`);
        }
        const pathItem = openapiSpec.paths[pathKeys[0]];
        if (pathItem) {
            const methodKeys = Object.keys(pathItem).filter(key => [
                'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'
            ].includes(key.toLowerCase()));
            if (methodKeys.length !== 1) {
                errors.push(`The path item in openapiSpecification.paths must contain exactly one HTTP method definition (found ${methodKeys.length}).`);
            }
        }
    }
    // Further validation (e.g., using a full OpenAPI parser/validator) could be added here.
    return errors;
};


/**
 * Controller to list available API tools.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const listTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[API Tool Service] Listing tools');
    try {
        // utilityService.listAvailableTools now returns ApiToolList
        const tools = await utilityService.listAvailableTools();
        res.status(200).json({ success: true, data: tools });
    } catch (error) {
        console.error('Error listing tools:', error);
        next(error); 
    }
};

/**
 * Controller to get detailed information about a specific API tool.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const getToolInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log(`[API Tool Service] Getting tool info for ID: ${req.params.id}`);
    try {
        const toolId = req.params.id;
        // utilityService.getToolDetails now returns Promise<ApiToolInfo | null>
        const toolInfo = await utilityService.getToolDetails(toolId);
        if (!toolInfo) {
            res.status(404).json({ success: false, error: `Tool with ID '${toolId}' not found.` });
            return;
        }
        res.status(200).json({ success: true, data: toolInfo });
    } catch (error) {
        console.error('Error getting tool info:', error);
        next(error);
    }
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

            // Normalize securitySecrets values to lowercase
            if (newApiTool.securitySecrets && typeof newApiTool.securitySecrets === 'object') {
                const secretKeys: Array<keyof ApiTool['securitySecrets']> = ["x-secret-name", "x-secret-username", "x-secret-password"];
                for (const key of secretKeys) {
                    if (newApiTool.securitySecrets[key] && typeof newApiTool.securitySecrets[key] === 'string') {
                        (newApiTool.securitySecrets[key] as string) = (newApiTool.securitySecrets[key] as string).toLowerCase();
                        // After toLowerCase(), it's still a string, which is compatible with UtilitySecretType (string | enum)
                        // No explicit cast to UtilitySecretType for the assignment target needed here, as the property itself is typed UtilitySecretType | undefined
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
                validationErrors.push(...validateOpenApiStructure(newApiTool.openapiSpecification));
            }

            if (!newApiTool.securityOption || typeof newApiTool.securityOption !== 'string') {
                validationErrors.push('Missing or invalid required field: securityOption (must be a string).');
            } else if (newApiTool.openapiSpecification && newApiTool.openapiSpecification.components?.securitySchemes) {
                if (!newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption]) {
                    validationErrors.push(`securityOption '${newApiTool.securityOption}' does not match any key in openapiSpecification.components.securitySchemes.`);
                }
            } else if (newApiTool.openapiSpecification) {
                 validationErrors.push('openapiSpecification.components.securitySchemes is missing, cannot validate securityOption.');
            }

            if (!newApiTool.securitySecrets || typeof newApiTool.securitySecrets !== 'object') {
                validationErrors.push('Missing or invalid required field: securitySecrets (must be an object).');
            } else if (newApiTool.openapiSpecification && newApiTool.openapiSpecification.components?.securitySchemes && newApiTool.securityOption && newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption]) {
                // Further validation based on the chosen securityOption's type
                const chosenScheme = newApiTool.openapiSpecification.components.securitySchemes[newApiTool.securityOption] as SecuritySchemeObject;
                const secretsProvided = newApiTool.securitySecrets;

                switch (chosenScheme.type) {
                    case 'apiKey':
                        if (!secretsProvided["x-secret-name"]) {
                            validationErrors.push(`For apiKey securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-name'.`);
                        }
                        if (secretsProvided["x-secret-username"] || secretsProvided["x-secret-password"]) {
                            validationErrors.push(`For apiKey securityOption '${newApiTool.securityOption}', securitySecrets should only define 'x-secret-name', not username/password.`);
                        }
                        break;
                    case 'http':
                        if (chosenScheme.scheme === 'bearer') {
                            if (!secretsProvided["x-secret-name"]) {
                                validationErrors.push(`For HTTP Bearer securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-name'.`);
                } 
                            if (secretsProvided["x-secret-username"] || secretsProvided["x-secret-password"]) {
                                validationErrors.push(`For HTTP Bearer securityOption '${newApiTool.securityOption}', securitySecrets should only define 'x-secret-name', not username/password.`);
                            }
                        } else if (chosenScheme.scheme === 'basic') {
                            if (!secretsProvided["x-secret-username"]) {
                                validationErrors.push(`For HTTP Basic securityOption '${newApiTool.securityOption}', securitySecrets must define 'x-secret-username'.`);
                }
                            // x-secret-password for basic is optional (implies empty)
                            if (secretsProvided["x-secret-name"]) {
                                validationErrors.push(`For HTTP Basic securityOption '${newApiTool.securityOption}', securitySecrets should not define 'x-secret-name'.`);
                            }
                } else {
                            validationErrors.push(`Unsupported HTTP scheme '${chosenScheme.scheme}' for securityOption '${newApiTool.securityOption}'.`);
                    }
                        break;
                    // case 'oauth2': // Add validation for oauth2 if/when supported
                    //     break;
                    default:
                        validationErrors.push(`Unsupported security scheme type '${chosenScheme.type}' for securityOption '${newApiTool.securityOption}'.`);
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
        res.status(201).json({ success: true, data: createdTool });

    } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ success: false, error: error.message });
        } else {
            console.error('Error creating tool:', error);
            next(error);
        }
    }
};

/**
 * Controller to execute a specific API tool.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const executeTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const toolId = req.params.id;
    console.log(`[API Tool Service] Attempting to execute tool ID: ${toolId}`);
    try {
        const { conversationId, params } : ExecuteToolPayload = req.body;
        const authHeaders = getAuthHeadersFromAgent(req);
        if (!authHeaders.success) {
            // Explicitly work with the error payload after confirming !authHeaders.success
            const errorPayload = authHeaders.error;
            let errorMessage = 'Authentication headers are missing or invalid.';
            let errorDetails: any = undefined;

            if (errorPayload) {
                if (typeof errorPayload === 'string') {
                    errorMessage = errorPayload;
                } else if (typeof errorPayload === 'object' && errorPayload !== null && 'message' in errorPayload) {
                    // If it's an object and has a message property, assume it's an error object.
                    errorMessage = (errorPayload as { message?: string }).message || errorMessage;
                    errorDetails = (errorPayload as { details?: any }).details;
                } else if (typeof errorPayload === 'object' && errorPayload !== null) {
                    // If it is an object but not with a message property, stringify it.
                    errorMessage = JSON.stringify(errorPayload);
                }
                // If errorPayload is not a string and not an object (e.g. boolean, number), it will keep the default errorMessage.
            }

            console.warn(`[API Tool Service] Missing auth headers for tool ${toolId}: ${errorMessage}`);
            const errorRes: ErrorResponse = { success: false, error: errorMessage, details: errorDetails };
            res.status(401).json(errorRes);
            return;
        }
        const agentServiceCredentials : AgentServiceCredentials = authHeaders.data;
        
        if (!conversationId || !params) { // toolId is already checked via req.params.id
            console.warn(`[API Tool Service] Missing required fields for tool ${toolId}: conversationId or params.`);
            res.status(400).json({ success: false, error: 'Missing required fields in payload: conversationId, params' });
            return;
        }

        console.log(`[API Tool Service] Executing tool ${toolId} with conversationId: ${conversationId}`);
        // utilityService.runToolExecution now returns ApiToolExecutionResponse
        const result: ApiToolExecutionResponse = await utilityService.runToolExecution(agentServiceCredentials, toolId, conversationId, params);

        // Handle ApiToolExecutionResponse structure
        if (result.success === true) {
            // Can be SuccessResponse<SetupNeeded> or SuccessResponse<unknown>
            const successData = (result as SuccessResponse<any>).data;
            if (typeof successData === 'object' && successData !== null && 'needsSetup' in successData && successData.needsSetup === true) {
                console.log(`[API Tool Service] Tool ${toolId} requires setup.`);
                res.status(200).json(result); // Forward SetupNeeded response
            } else {
                console.log(`[API Tool Service] Tool ${toolId} executed successfully.`);
                res.status(200).json(result); // Forward success response with actual tool output
            }
        } else {
            // It's an ErrorResponse
            console.error(`[API Tool Service] Error executing tool ${toolId}:`, (result as ErrorResponse).error);
            res.status(400).json(result); // Forward error response (consider mapping to other HTTP statuses if needed)
        }

    } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
            console.error(`[API Tool Service] Tool ${toolId} not found during execution attempt.`);
            res.status(404).json({ success: false, error: error.message });
         } else {
            console.error(`[API Tool Service] Unexpected error executing tool ${toolId}:`, error);
            next(error); 
         }
    }
}; 