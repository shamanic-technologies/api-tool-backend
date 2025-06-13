import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService.js';
import {
    // @ts-ignore type exist but not recognized for unknown reason
    ApiToolExecutionResult,
    ExecuteToolPayload,
    SuccessResponse, // Added for explicit typing
    HumanInternalCredentials,
    SetupNeeded,
    ServiceResponse
} from '@agent-base/types';
// getAuthHeadersFromAgent is no longer needed here, it's handled by agentAuthMiddleware
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware.js'; // Import the interface
import { runToolExecution } from '../services/runToolService.js';

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
    const serviceCredentials = authenticatedReq.humanInternalCredentials;
    
    try {
        // Ensure serviceCredentials exist (should be guaranteed by middleware, but good for robustness)
        if (!serviceCredentials) {
            console.error(`[API Tool Service] executeTool called without serviceCredentials. This should have been caught by middleware.`);
            res.status(401).json({ 
                success: false, 
                error: 'Unauthorized: Missing service credentials.',
                hint: "This error shouldn't happen. Please contact support."
            });
            return;
        }

        const { conversationId, params } : ExecuteToolPayload = req.body;
        
        if (!conversationId || !params) { 
            console.error(`[API Tool Service] Missing required fields for tool ${toolId}: conversationId or params.`);
            res.status(400).json({ 
                success: false, 
                error: 'Missing required fields in payload: conversationId, params',
                hint: "This error shouldn't happen. Please contact support."
            });
            return;
        }

        // Ensure platformUserId is a string, as expected by runToolExecution
        if (typeof serviceCredentials.platformUserId !== 'string') {
            console.error(`[API Tool Service] platformUserId is unexpectedly not a string in serviceCredentials for user: ${serviceCredentials.clientUserId}`);
            res.status(500).json({ 
                success: false, 
                error: 'Internal server error: Invalid platform user ID in credentials.',
                hint: "This error shouldn't happen. Please contact support."
            });
            return;
        }

        const toolExecutionResult: ServiceResponse<ApiToolExecutionResult> = await runToolExecution(
            serviceCredentials as Required<HumanInternalCredentials>, // Cast to satisfy AgentServiceCredentials if platformUserId is the only diff
            toolId,
            conversationId,
            params
        );

        if (toolExecutionResult.success && toolExecutionResult.data && typeof toolExecutionResult.data === 'object' && toolExecutionResult.data !== null && 'needsSetup' in toolExecutionResult.data && toolExecutionResult.data.needsSetup === true) {
            toolExecutionResult.hint = `Given the tool requires setup, then a form has been automatically displayed in the chat.
                    For each required secret, the form display a safe input form with a title for the user to input the values.
                    Values are stored in a secure way (Google Secret Manager) and will be used to execute the tool in the backend.
                    For each of those secrets, display a short instructions (with a link) for the user to retrive those values in the external tool's dashboard.
                    Ask the user to notify you when the setup is complete, so you can execute the tool again and check if it is working this time.`
            res.status(200).json(toolExecutionResult);
        } else {
            res.status(200).json(toolExecutionResult);
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