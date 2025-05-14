import { Router } from 'express';
import * as createToolController from '../controllers/createToolController';
import * as listToolsController from '../controllers/listToolsController';
import * as getToolInfoController from '../controllers/getToolInfoController';
import * as executeToolController from '../controllers/executeToolController';
const router: Router = Router();

// GET /api/tools - List available tools (ID and description)
router.get('/', listToolsController.listTools);

// GET /api/tools/:id - Get tool info (ID, description, schema)
router.get('/:id', getToolInfoController.getToolInfo);

// POST /api/tools - Create a new tool configuration
router.post('/', createToolController.createTool);

// POST /api/tools/:id/execute - Execute a tool
router.post('/:id/execute', executeToolController.executeTool);

export default router; 