import { Request, Response, NextFunction } from 'express';

/**
 * @function serviceKeyAuthMiddleware
 * @description Middleware to authenticate requests using a service API key.
 * It checks for an 'Authorization' header with a Bearer token (the service key)
 * and validates it against the API_TOOL_API_KEY environment variable.
 *
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {NextFunction} next - Express next middleware function.
 */
export const serviceKeyAuthMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const serviceKey = process.env.API_TOOL_API_KEY;

  // It is crucial that the service key is configured in the environment.
  if (!serviceKey) {
    console.error('CRITICAL: API_TOOL_API_KEY is not set in environment variables for api-tool-backend.');
    // In a production environment, you might want to prevent the service from starting or throw a more critical error.
    // For now, sending a 500 to indicate a server-side configuration issue.
    res.status(500).json({ success: false, error: 'Internal Server Error: Service API Key not configured.' });
    return;
  }

  const authHeader = req.headers.authorization;

  // Check if Authorization header exists and is in the correct Bearer token format.
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[Service Key Auth] Unauthorized: Missing or invalid Authorization header.');
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      details: 'Missing or invalid Authorization header.',
      hint: 'This error should not happen. Contact support'
    });
    return;
  }

  const providedKey = authHeader.split(' ')[1];

  // Validate the provided API key against the configured service key.
  if (providedKey !== serviceKey) {
    console.error('[Service Key Auth] Unauthorized: Invalid Service API Key provided.');
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      details: 'Invalid Service API Key.',
      hint: 'This error should not happen. Contact support'
    });
    return;
  }

  // If the key is valid, proceed to the next middleware or route handler.
  next();
}; 