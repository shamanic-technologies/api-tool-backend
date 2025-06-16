import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService.js';
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware.js';

/**
 * Controller to rename an existing API tool.
 * Requires agent authentication to identify the user.
 * @param {Request} req Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const renameTool = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authenticatedReq = req as AuthenticatedRequestWithAgent;
    const humanInternalCredentials = authenticatedReq.humanInternalCredentials;
    const { id: toolId } = req.params;
    const { name: newName } = req.body;

    if (!humanInternalCredentials || !humanInternalCredentials.clientUserId || !humanInternalCredentials.clientOrganizationId) {
        console.error(`[RenameToolController] Unauthorized: User ID or Organization ID is missing from credentials.`);
        res.status(401).json({
            success: false,
            error: 'Unauthorized: User ID or Organization ID is missing from credentials.',
        });
        return;
    }
    const { clientUserId: userId, clientOrganizationId: organizationId } = humanInternalCredentials;

    if (!toolId) {
        console.error(`[RenameToolController] Bad Request: Tool ID is missing from request parameters.`);
        res.status(400).json({ success: false, error: 'Tool ID is missing from request parameters.' });
        return;
    }

    if (typeof newName !== 'string' || newName.trim() === '') {
        console.error(`[RenameToolController] Bad Request: New name must be a non-empty string.`);
        res.status(400).json({ success: false, error: 'New name must be a non-empty string.' });
        return;
    }

    try {
        const renamedTool = await utilityService.renameTool(toolId, newName.trim(), userId, organizationId);
        res.status(200).json({ success: true, data: renamedTool });
    } catch (error) {
        if (error instanceof Error) {
            if (error.message === 'Tool not found.') {
                res.status(404).json({ success: false, error: error.message });
            } else if (error.message.includes('Forbidden')) {
                res.status(403).json({ success: false, error: error.message });
            } else {
                res.status(500).json({ success: false, error: `Failed to rename tool: ${error.message}` });
            }
        } else {
            next(error);
        }
    }
}; 