import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    ApiToolExecutionResponse, 
    ExecuteToolPayload,
    SuccessResponse, // Added for explicit typing
    ServiceCredentials
} from '@agent-base/types'; 
// getAuthHeadersFromAgent is no longer needed here, it's handled by agentAuthMiddleware
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware'; // Import the interface
import { runToolExecution } from '../services/runToolService';
/**
 * Controller to execute a specific API tool.
 * Relies on 'agentAuthMiddleware' to have populated 'req.agentServiceCredentials'.
 * @param {Request} req Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const executeTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const toolId = req.params.id;
    // Cast req to AuthenticatedRequestWithAgent to access serviceCredentials
    const authenticatedReq = req as AuthenticatedRequestWithAgent;
    const serviceCredentials = authenticatedReq.serviceCredentials;

    console.log(`[API Tool Service] Attempting to execute tool ID: ${toolId} by user: ${serviceCredentials.clientUserId}`);
    
    try {
        // Ensure serviceCredentials exist (should be guaranteed by middleware, but good for robustness)
        if (!serviceCredentials) {
            console.warn(`[API Tool Service] executeTool called without serviceCredentials. This should have been caught by middleware.`);
            res.status(401).json({ success: false, error: 'Unauthorized: Missing service credentials.' });
            return;
        }

        const { conversationId, params } : ExecuteToolPayload = req.body;
        
        if (!conversationId || !params) { 
            console.warn(`[API Tool Service] Missing required fields for tool ${toolId}: conversationId or params.`);
            res.status(400).json({ success: false, error: 'Missing required fields in payload: conversationId, params' });
            return;
        }

        // Ensure platformUserId is a string, as expected by runToolExecution
        if (typeof serviceCredentials.platformUserId !== 'string') {
            console.error(`[API Tool Service] platformUserId is unexpectedly not a string in serviceCredentials for user: ${serviceCredentials.clientUserId}`);
            res.status(500).json({ success: false, error: 'Internal server error: Invalid platform user ID in credentials.'});
            return;
        }

        console.log(`[API Tool Service] Executing tool ${toolId} for conversationId: ${conversationId} by user: ${serviceCredentials.clientUserId}`);
        const result: ApiToolExecutionResponse = await runToolExecution(
            serviceCredentials as Required<ServiceCredentials>, // Cast to satisfy AgentServiceCredentials if platformUserId is the only diff
            toolId, 
            conversationId, 
            params
        );

        if (result.success === true) {
            const successResult = result as SuccessResponse<any>; 
            const successData = successResult.data;

            if (typeof successData === 'object' && successData !== null && 'needsSetup' in successData && successData.needsSetup === true) {
                console.log(`[API Tool Service] Tool ${toolId} requires setup for user: ${serviceCredentials.clientUserId}.`);
                successResult.data.hint = `Given the tool requires setup, then a form has been automatically displayed in the chat.
                        For each required secret, the form display an input field with a title for the user to safely input the values.
                        For each of those values, display a clickable link, opening a new tab, and short instructions for the user to retrive those values.
                        Ask the user to notify you when the setup is complete, so you can execute the tool again.`
                res.status(200).json(successResult); 
            } else {
                console.log(`[API Tool Service] Tool ${toolId} executed successfully for user: ${serviceCredentials.clientUserId}.`);
                res.status(200).json(successResult); 
            }
        } else {
            console.error(`[API Tool Service] Error executing tool ${toolId} for user: ${serviceCredentials.clientUserId}:`, (result as any).error);
            res.status(400).json(result); 
        }

    } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
           console.error(`[API Tool Service] Tool ${toolId} not found during execution attempt by user: ${serviceCredentials.clientUserId}.`);
           res.status(404).json({ success: false, error: error.message });
        } else {
           console.error(`[API Tool Service] Unexpected error executing tool ${toolId} for user: ${serviceCredentials.clientUserId}:`, error);
           next(error); 
        }
    }
}; 