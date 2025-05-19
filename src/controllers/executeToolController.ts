import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { 
    ApiToolExecutionResponse, 
    ExecuteToolPayload,
    SuccessResponse // Added for explicit typing
} from '@agent-base/types'; 
// getAuthHeadersFromAgent is no longer needed here, it's handled by agentAuthMiddleware
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware'; // Import the interface

/**
 * Controller to execute a specific API tool.
 * Relies on 'agentAuthMiddleware' to have populated 'req.agentServiceCredentials'.
 * @param {Request} req Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const executeTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const toolId = req.params.id;
    // Cast req to AuthenticatedRequestWithAgent to access agentServiceCredentials
    const authenticatedReq = req as AuthenticatedRequestWithAgent;
    const agentServiceCredentials = authenticatedReq.agentServiceCredentials;

    console.log(`[API Tool Service] Attempting to execute tool ID: ${toolId} by user: ${agentServiceCredentials.clientUserId}`);
    
    try {
        // Ensure agentServiceCredentials exist (should be guaranteed by middleware, but good for robustness)
        if (!agentServiceCredentials) {
            console.warn(`[API Tool Service] executeTool called without agentServiceCredentials. This should have been caught by middleware.`);
            res.status(401).json({ success: false, error: 'Unauthorized: Missing agent credentials.' });
            return;
        }

        const { conversationId, params } : ExecuteToolPayload = req.body;
        
        if (!conversationId || !params) { 
            console.warn(`[API Tool Service] Missing required fields for tool ${toolId}: conversationId or params.`);
            res.status(400).json({ success: false, error: 'Missing required fields in payload: conversationId, params' });
            return;
        }

        console.log(`[API Tool Service] Executing tool ${toolId} for conversationId: ${conversationId} by user: ${agentServiceCredentials.clientUserId}`);
        const result: ApiToolExecutionResponse = await utilityService.runToolExecution(agentServiceCredentials, toolId, conversationId, params);

        if (result.success === true) {
            const successResult = result as SuccessResponse<any>; 
            const successData = successResult.data;

            if (typeof successData === 'object' && successData !== null && 'needsSetup' in successData && successData.needsSetup === true) {
                console.log(`[API Tool Service] Tool ${toolId} requires setup for user: ${agentServiceCredentials.clientUserId}.`);
                successResult.data.hint = `Given the tool requires setup, then a form has been automatically displayed in the chat.
                        For each required secret, the form display an input field with a title for the user to safely input the values.
                        For each of those values, display a clickable link, opening a new tab, and short instructions for the user to retrive those values.
                        Ask the user to notify you when the setup is complete, so you can execute the tool again.`
                res.status(200).json(successResult); 
            } else {
                console.log(`[API Tool Service] Tool ${toolId} executed successfully for user: ${agentServiceCredentials.clientUserId}.`);
                res.status(200).json(successResult); 
            }
        } else {
            console.error(`[API Tool Service] Error executing tool ${toolId} for user: ${agentServiceCredentials.clientUserId}:`, (result as any).error);
            res.status(400).json(result); 
        }

    } catch (error) {
         if (error instanceof Error && error.message.includes('not found')) {
            console.error(`[API Tool Service] Tool ${toolId} not found during execution attempt by user: ${agentServiceCredentials.clientUserId}.`);
            res.status(404).json({ success: false, error: error.message });
         } else {
            console.error(`[API Tool Service] Unexpected error executing tool ${toolId} for user: ${agentServiceCredentials.clientUserId}:`, error);
            next(error); 
         }
    }
}; 