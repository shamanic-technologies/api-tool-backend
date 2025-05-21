import { Request, Response, NextFunction } from 'express';
import * as utilityService from '../services/utilityService.js';
import { 
    // ApiTool, 
    ApiToolInfo, 
    // ExecuteToolPayload, 
    // AgentServiceCredentials, 
    // ApiToolExecutionResponse, 
    // ErrorResponse, 
    // SuccessResponse, 
    // UtilitySecretType,
    // UtilityProvider
    // NO SecuritySchemeObject import from @agent-base/types
} from '@agent-base/types'; 
// import { getAuthHeadersFromAgent } from '@agent-base/api-client'; // Not used in getToolInfo
// SecuritySchemeObject is imported ONLY from openapi3-ts/oas30
// import { OpenAPIObject, SecuritySchemeObject } from 'openapi3-ts/oas30'; // Not used in getToolInfo

/**
 * Controller to get detailed information about a specific API tool.
 * @param {Request} req Express request object.
 * @param {Response} res Express response object.
 * @param {NextFunction} next Express next middleware function.
 */
export const getToolInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    console.log(`[API Tool Service] Getting tool info for ID: ${req.params.id}`);
    try {
        const toolId = req.params.id;
        // utilityService.getToolDetails now returns Promise<ApiToolInfo | null>
        const toolInfo = await utilityService.getToolDetails(toolId);
        if (!toolInfo) {
            res.status(404).json({ success: false, error: `Tool with ID '${toolId}' not found.` });
            return;
        }
        res.status(200).json({ success: true, data: toolInfo });
    } catch (error) {
        console.error('Error getting tool info:', error);
        next(error);
    }
}; 