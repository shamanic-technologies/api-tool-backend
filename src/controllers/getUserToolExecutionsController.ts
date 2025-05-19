import { Request, Response } from 'express';
import { getToolExecutionsByUserId } from '../services/databaseService'; // Updated import
import { ApiToolExecutionRecord } from '../types/db.types'; // Import the type for clarity
import { AuthenticatedRequestWithAgent } from '../middleware/agentAuthMiddleware'; // Import the interface

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
    const agentServiceCredentials = authenticatedReq.agentServiceCredentials;

    if (!agentServiceCredentials || !agentServiceCredentials.clientUserId) {
      console.warn('[CONTROLLER] getUserToolExecutions called without valid agentServiceCredentials or clientUserId.');
      res.status(401).json({ error: 'Unauthorized: User ID is missing or invalid from agent credentials.' });
      return;
    }
    const userId = agentServiceCredentials.clientUserId;

    console.log(`[CONTROLLER] Fetching tool executions for user ID: ${userId}`);
    const executions: ApiToolExecutionRecord[] = await getToolExecutionsByUserId(userId);
    
    res.status(200).json(executions);

  } catch (error) {
    console.error(`[CONTROLLER] Error fetching user tool executions:`, error);
    res.status(500).json({ error: 'Failed to fetch user tool executions' });
  }
}; 