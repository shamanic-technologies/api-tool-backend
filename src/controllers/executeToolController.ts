import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    // ApiTool, 
    // ApiToolInfo, 
    // ExecuteToolPayload, // Review if this payload structure is still optimal or if direct params are fine
    AgentServiceCredentials, 
    ApiToolExecutionResponse, 
    ErrorResponse, 
    SuccessResponse, 
    // UtilitySecretType,
    // UtilityProvider
    // NO SecuritySchemeObject import from @agent-base/types
} from '@agent-base/types'; 
import { getAuthHeadersFromAgent } from '@agent-base/api-client';
// SecuritySchemeObject is imported ONLY from openapi3-ts/oas30
// import { OpenAPIObject, SecuritySchemeObject } from 'openapi3-ts/oas30'; // Not used in executeTool

// Assuming ExecuteToolPayload might be defined like this or passed flatly
interface ExecuteToolPayload {
    conversationId: string;
    params: Record<string, any>;
}

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