import { Request, Response, NextFunction } from 'express';
import { AgentServiceCredentials, ErrorResponse } from '@agent-base/types';
import { getAuthHeadersFromAgent } from '@agent-base/api-client';

/**
 * @interface AuthenticatedRequestWithAgent
 * @description Extends the Express Request interface to include agentServiceCredentials.
 * These credentials are set after successful authentication by the agentAuthMiddleware.
 */
export interface AuthenticatedRequestWithAgent extends Request {
  agentServiceCredentials: AgentServiceCredentials;
}

/**
 * @function agentAuthMiddleware
 * @description Middleware to authenticate requests based on agent service credentials provided in headers.
 * It uses 'getAuthHeadersFromAgent' to extract and validate these credentials.
 * If authentication is successful, credentials are attached to 'req.agentServiceCredentials'.
 * Otherwise, a 401 Unauthorized response is sent.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {NextFunction} next - Express next middleware function.
 */
export const agentAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeaders = getAuthHeadersFromAgent(req);

  if (!authHeaders.success) {
    const errorPayload = authHeaders.error;
    let errorMessage = 'Authentication headers are missing or invalid.';
    let errorDetails: any = undefined;

    // Normalize error message and details from the authHeaders.error payload
    if (errorPayload) {
      if (typeof errorPayload === 'string') {
        errorMessage = errorPayload;
      } else if (typeof errorPayload === 'object' && errorPayload !== null) {
        errorMessage = (errorPayload as { message?: string }).message || JSON.stringify(errorPayload);
        errorDetails = (errorPayload as { details?: any }).details;
      }
    }

    console.warn(`[Agent Auth Middleware] Authentication failed: ${errorMessage}`);
    const errorRes: ErrorResponse = { success: false, error: errorMessage, details: errorDetails };
    res.status(401).json(errorRes);
    return;
  }

  // Attach credentials to the request object for use in subsequent handlers
  (req as AuthenticatedRequestWithAgent).agentServiceCredentials = authHeaders.data;
  
  console.log(`[Agent Auth Middleware] Authenticated successfully for clientUserId: ${authHeaders.data.clientUserId}`);
  next();
}; 