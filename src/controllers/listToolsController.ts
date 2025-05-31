import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService.js';

/**
 * Controller to list available API tools.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const listTools = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log('[API Tool Service] Listing tools');
    try {
        // utilityService.listAvailableTools now returns ApiToolList
        const tools = await utilityService.listAvailableTools();
        res.status(200).json({ success: true, data: tools });
    } catch (error) {
        console.error('Error listing tools:', error);
        next(error); 
    }
}; 