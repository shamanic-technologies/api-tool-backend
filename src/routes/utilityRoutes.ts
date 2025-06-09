import express, { Router } from 'express';
import * as createToolController from '../controllers/createToolController.js';
import * as listToolsController from '../controllers/listToolsController.js';
import * as getToolInfoController from '../controllers/getToolInfoController.js';
import * as executeToolController from '../controllers/executeToolController.js';
import * as getUserApiToolsController from '../controllers/getUserApiToolsController.js';
import * as getUserToolExecutionsController from '../controllers/getUserToolExecutionsController.js';

// Import Middlewares
import { serviceKeyAuthMiddleware } from '../middleware/serviceKeyAuthMiddleware.js';
import { agentAuthMiddleware } from '../middleware/agentAuthMiddleware.js';

const router: Router = express.Router();

// Apply serviceKeyAuthMiddleware to all routes in this router first
router.use(serviceKeyAuthMiddleware);

// GET /api/tools - List available tools (ID and description)
// Protected by serviceKeyAuthMiddleware (applied above)
router.get('/', listToolsController.listTools);

// GET /api/user-api-tools - Get all API tools for the authenticated user
// Protected by serviceKeyAuthMiddleware (applied above) and agentAuthMiddleware
router.get('/user-api-tools', agentAuthMiddleware, getUserApiToolsController.getUserApiTools);

// GET /api/user-tool-executions - Get all tool executions for the authenticated user
// Protected by serviceKeyAuthMiddleware (applied above) and agentAuthMiddleware
router.get('/user-tool-executions', agentAuthMiddleware, getUserToolExecutionsController.getUserToolExecutions);

// GET /api/tools/:id - Get tool info (ID, description, schema)
// Protected by serviceKeyAuthMiddleware (applied above)
router.get('/:id', getToolInfoController.getToolInfo);

// POST /api/tools - Create a new tool
// Protected by serviceKeyAuthMiddleware (applied above) and agentAuthMiddleware
router.post('/', agentAuthMiddleware, createToolController.createTool);

// POST /api/tools/:id/execute - Execute a tool
// Protected by serviceKeyAuthMiddleware (applied above) and agentAuthMiddleware
router.post('/:id/execute', agentAuthMiddleware, executeToolController.executeTool);

export default router; 