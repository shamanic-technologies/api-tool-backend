import { Request, Response, NextFunction } from 'express';
import { getToolExecutionsByUserId } from '../services/databaseService.js'; // Updated import
import { ApiToolExecutionRecord } from '../types/db.types.js'; // Import the type for clarity
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware.js'; // Import the interface
import { ApiToolExecution } from '@agent-base/types';

/**
 * @description Handles the request to get all tool executions for the authenticated user.
 * Assumes that 'agentAuthMiddleware' has populated `req.agentServiceCredentials`.
 * @param {Request} req - The Express request object, expected to be AuthenticatedRequestWithAgent.
 * @param {Response} res - The Express response object.
 * @returns {Promise<void>}
 */
export const getUserToolExecutions = async (req: Request, res: Response): Promise<void> => {
  try {
    const authenticatedReq = req as AuthenticatedRequestWithAgent;
    const serviceCredentials = authenticatedReq.humanInternalCredentials;

    if (!serviceCredentials || !serviceCredentials.clientUserId || !serviceCredentials.clientOrganizationId) {
      console.error('[CONTROLLER] getUserToolExecutions called without valid serviceCredentials or clientUserId.');
      res.status(401).json({ error: 'Unauthorized: User ID is missing or invalid from service credentials.' });
      return;
    }
    const userId = serviceCredentials.clientUserId;
    const organizationId = serviceCredentials.clientOrganizationId;

    const executions: ApiToolExecution[] = await getToolExecutionsByUserId(userId, organizationId);
    
    res.status(200).json(executions);

  } catch (error) {
    console.error(`[CONTROLLER] Error fetching user tool executions:`, error);
    res.status(500).json({ error: 'Failed to fetch user tool executions' });
  }
}; 