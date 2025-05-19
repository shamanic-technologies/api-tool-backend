import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { UserApiToolRecord } from '../types/db.types';
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware';

/**
 * Controller to get all API tools for a specific user.
 * Relies on 'agentAuthMiddleware' to have populated 'req.agentServiceCredentials'.
 * @param {Request} req Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const getUserApiTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const authenticatedReq = req as AuthenticatedRequestWithAgent;
        const agentServiceCredentials = authenticatedReq.agentServiceCredentials;

        if (!agentServiceCredentials || !agentServiceCredentials.clientUserId) {
            console.warn('[API Tool Service] getUserApiTools called without valid agentServiceCredentials or clientUserId.');
            res.status(401).json({ success: false, error: 'Unauthorized: User ID is missing or invalid from agent credentials.' });
            return;
        }
        const userId = agentServiceCredentials.clientUserId;

        console.log(`[API Tool Service] Getting API tools for user ID: ${userId}`);
        const userApiTools: UserApiToolRecord[] = await utilityService.getUserApiTools(userId);
        res.status(200).json({ success: true, data: userApiTools });

    } catch (error) {
        console.error(`[API Tool Service] Error getting API tools for user ${ (req as AuthenticatedRequestWithAgent).agentServiceCredentials?.clientUserId || 'unknown'}:`, error);
        next(error); 
    }
}; 