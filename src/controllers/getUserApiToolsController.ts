import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService';
import { UserApiToolRecord } from '../types/db.types';
import { getAuthHeadersFromAgent } from '@agent-base/api-client';
import { AgentServiceCredentials, ErrorResponse } from '@agent-base/types';

/**
 * Controller to get all API tools for a specific user.
 * Retrieves userId from authenticated request headers.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const getUserApiTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const authResponse = getAuthHeadersFromAgent(req);

        if (!authResponse.success) {
            const errorPayload = authResponse.error;
            let errorMessage = 'Authentication headers are missing or invalid.';
            let errorDetails: any = undefined;

            if (errorPayload) {
                if (typeof errorPayload === 'string') {
                    errorMessage = errorPayload;
                } else if (typeof errorPayload === 'object' && errorPayload !== null && 'message' in errorPayload) {
                    errorMessage = (errorPayload as { message?: string }).message || errorMessage;
                    errorDetails = (errorPayload as { details?: any }).details;
                } else if (typeof errorPayload === 'object' && errorPayload !== null) {
                    errorMessage = JSON.stringify(errorPayload);
                }
            }
            console.warn(`[API Tool Service] Missing/invalid auth headers for getUserApiTools: ${errorMessage}`);
            const errorRes: ErrorResponse = { success: false, error: errorMessage, details: errorDetails };
            res.status(401).json(errorRes);
            return;
        }

        const agentServiceCredentials = authResponse.data as AgentServiceCredentials;
        const userId = agentServiceCredentials.clientUserId;

        if (!userId) {
            // This should ideally not be reached if authResponse.success is true and data is valid AgentServiceCredentials
            console.error('[API Tool Service] User ID is missing from authenticated credentials.');
            res.status(500).json({ success: false, error: 'Internal server error: User ID missing post-authentication.' });
            return;
        }

        console.log(`[API Tool Service] Getting API tools for user ID: ${userId}`);
        const userApiTools: UserApiToolRecord[] = await utilityService.getUserApiTools(userId);
        res.status(200).json({ success: true, data: userApiTools });

    } catch (error) {
        console.error('Error getting user API tools:', error);
        next(error); // Pass error to the global error handler
    }
}; 