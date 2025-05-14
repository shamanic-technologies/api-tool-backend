import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { ExternalUtilityInfo, ExternalUtilityTool, AuthMethod, ApiKeyAuthScheme, ExecuteToolPayload, AgentServiceCredentials } from '@agent-base/types'; // Assuming types are here
import { getAuthHeadersFromAgent } from '@agent-base/api-client';

// Controller to list available utility tools
export const listTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[External Utility Tool Service] Listing tools');
    try {
        const tools = await utilityService.listAvailableTools();
        res.status(200).json({ success: true, data: tools });
    } catch (error) {
        console.error('Error listing tools:', error);
        next(error); // Pass error to global error handler
    }
};

// Controller to get detailed information about a specific tool
export const getToolInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[External Utility Tool Service] Getting tool info');
    try {
        const toolId = req.params.id;
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

// Controller to create a new tool configuration
export const createTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[External Utility Tool Service] Creating tool');
    try {
        const newConfig: ExternalUtilityTool = req.body;
        const validationErrors: string[] = [];

        // --- Start Enhanced Validation ---

        // 1. Basic presence checks
        if (!newConfig) validationErrors.push('Request body is empty.');
        else {
            if (!newConfig.id) validationErrors.push('Missing required field: id');
            if (!newConfig.utilityProvider) validationErrors.push('Missing required field: utilityProvider');
            if (!newConfig.description) validationErrors.push('Missing required field: description');
            if (!newConfig.schema) validationErrors.push('Missing required field: schema');
            if (!newConfig.authMethod) validationErrors.push('Missing required field: authMethod');
            // requiredSecrets can be empty, but must exist
            if (!Array.isArray(newConfig.requiredSecrets)) validationErrors.push('Missing or invalid field: requiredSecrets (must be an array)');

            // 2. Schema structure validation
            if (newConfig.schema) {
                // Check if the schema object itself conforms to the basic JSON Schema structure
                if (typeof newConfig.schema !== 'object' || 
                    Array.isArray(newConfig.schema) || 
                    newConfig.schema.type !== 'object' || // Check for top-level type: 'object'
                    typeof newConfig.schema.properties !== 'object') { // Check for properties object
                    // Enhance the error message for clarity
                    validationErrors.push(
                        "Invalid 'schema' field: It MUST be a standard JSON Schema object defining the tool's input parameters. " + 
                        "It requires a top-level `type` set to `'object'` and a `properties` object containing the parameter definitions. " + 
                        "Example structure: `{ \"type\": \"object\", \"properties\": { \"param1\": { \"type\": \"string\", ... }, \"param2\": { ... } } }`"
                    );
                } 
            }

            // 3. AuthMethod specific validation
            if (newConfig.authMethod === AuthMethod.OAUTH) {
                if (!Array.isArray(newConfig.requiredScopes) || newConfig.requiredScopes.length === 0) {
                    validationErrors.push('OAuth requires a non-empty requiredScopes array.');
                }
            } else if (newConfig.authMethod === AuthMethod.API_KEY) {
                if (!newConfig.apiKeyDetails) {
                    validationErrors.push('API_KEY authMethod requires apiKeyDetails object.');
                } else {
                    if (!newConfig.apiKeyDetails.secretName) validationErrors.push('apiKeyDetails requires secretName.');
                    if (!newConfig.apiKeyDetails.scheme) validationErrors.push('apiKeyDetails requires scheme.');
                    if (newConfig.apiKeyDetails.scheme === ApiKeyAuthScheme.HEADER && !newConfig.apiKeyDetails.headerName) {
                        validationErrors.push('apiKeyDetails with scheme HEADER requires headerName.');
                    }
                }
            } // No specific checks for AuthMethod.NONE

            // 4. apiDetails validation (if present)
            if (newConfig.apiDetails) {
                if (!newConfig.apiDetails.method) validationErrors.push('apiDetails requires method.');
                if (!newConfig.apiDetails.baseUrl) validationErrors.push('apiDetails requires baseUrl.');
                if (!newConfig.apiDetails.pathTemplate) validationErrors.push('apiDetails requires pathTemplate.');
                // Deeper validation of paramMappings could be added if needed
            }
        }

        // --- End Enhanced Validation ---

        if (validationErrors.length > 0) {
            res.status(400).json({ 
                success: false, 
                error: 'Invalid tool configuration provided.',
                details: validationErrors
            });
            return;
        }

        // If validation passes, proceed to add the tool
        const createdTool = await utilityService.addNewTool(newConfig);
        res.status(201).json({ success: true, data: createdTool });

    } catch (error) {
        // Handle potential duplicate ID error from service
        if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ success: false, error: error.message });
        } else {
            console.error('Error creating tool:', error);
            next(error);
        }
    }
};

// Controller to execute a specific utility tool
export const executeTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[External Utility Tool Service] Executing tool');
    try {
        const toolId = req.params.id;
        const { conversationId, params } : ExecuteToolPayload = req.body;
        const authHeaders = getAuthHeadersFromAgent(req);
        if (!authHeaders.success) {
            console.log('[External Utility Tool Service] Missing auth headers:', authHeaders);
            res.status(401).json(authHeaders);
            return;
        }
        const agentServiceCredentials : AgentServiceCredentials = authHeaders.data;
        // Basic input validation
        if (!toolId || !conversationId || !params) {
            console.log('[External Utility Tool Service] Missing required fields:', toolId, conversationId, params);
            res.status(400).json({ success: false, error: 'Missing required fields: toolId, conversationId, params' });
            return;
        }

        const result = await utilityService.runToolExecution(agentServiceCredentials, toolId, conversationId, params);

        // Check if the result indicates setup is needed
        if (result.success === true && result.data?.needs_setup === true) {
             // It's a SetupNeededResponse - return as is (likely status 200)
             res.status(200).json(result);
        } else if (result.success === true) {
            // It's a UtilitySuccessResponse
            res.status(200).json(result);
        } else {
            console.log('[External Utility Tool Service] Error executing tool:', result);
            // It's a UtilityErrorResponse - potentially map to HTTP status codes later
            res.status(400).json(result); // Use 400 for general tool execution errors for now
        }

    } catch (error) {
         // Catch errors from the service layer (e.g., tool not found)
         if (error instanceof Error && error.message.includes('not found')) {
            res.status(404).json({ success: false, error: error.message });
         } else {
            console.error('Error executing tool:', error);
            next(error); // Pass other errors to the global handler
         }
    }
}; 