import { Request, Response, NextFunction } from 'express';
import * as executionStatsService from '../services/searchService.js';
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware.js';
import { SearchApiToolResult, SearchApiToolResultItem } from '@agent-base/types';

/**
 * Controller to get all API tools for a specific user.
 * The result is a SearchApiToolResult object containing items and total count.
 * Relies on 'agentAuthMiddleware' to have populated 'req.agentServiceCredentials'.
 * @param {Request} req Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const getUserApiTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const authenticatedReq = req as AuthenticatedRequestWithAgent;
        const serviceCredentials = authenticatedReq.humanInternalCredentials;

        if (!serviceCredentials || !serviceCredentials.clientUserId || !serviceCredentials.clientOrganizationId) {
            console.error('[API Tool Service] getUserApiTools controller called without valid serviceCredentials or clientUserId.');
            res.status(401).json({ success: false, error: 'Unauthorized: User ID is missing or invalid from service credentials.' });
            return;
        }
        const requestingUserId = serviceCredentials.clientUserId;
        const requestingOrganizationId = serviceCredentials.clientOrganizationId;
        
        const searchApiToolResult: SearchApiToolResult = await executionStatsService.getUserApiTools(requestingUserId, requestingOrganizationId);
        
        res.status(200).json({ success: true, data: searchApiToolResult });

    } catch (error) {
        const clientUserId = (req as AuthenticatedRequestWithAgent).humanInternalCredentials?.clientUserId || 'unknown';
        console.error(`[API Tool Service] Controller: Error getting API tools for user ${clientUserId}:`, error);
        next(error); 
    }
}; 