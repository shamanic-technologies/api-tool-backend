import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService.js';
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware.js';

/**
 * Controller to list available API tools for a given user and organization.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const listTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const authenticatedReq = req as AuthenticatedRequestWithAgent;
        const humanInternalCredentials = authenticatedReq.humanInternalCredentials;

        if (!humanInternalCredentials || !humanInternalCredentials.clientUserId || !humanInternalCredentials.clientOrganizationId) {
            console.error('Unauthorized: User ID or Organization ID is missing from credentials.');
            res.status(401).json({
                success: false,
                error: 'Unauthorized: User ID or Organization ID is missing from credentials.',
            });
            return;
        }
        const { clientUserId: userId, clientOrganizationId: organizationId } = humanInternalCredentials;

        const tools = await utilityService.listAvailableTools(userId, organizationId);
        res.status(200).json({ success: true, data: tools });
    } catch (error) {
        console.error('Error listing tools:', error);
        next(error);
    }
}; 