import { Router } from 'express';
import * as utilityController from '../controllers/utilityController';

const router: Router = Router();

// GET /api/tools - List available tools (ID and description)
router.get('/', utilityController.listTools);

// GET /api/tools/:id - Get tool info (ID, description, schema)
router.get('/:id', utilityController.getToolInfo);

// POST /api/tools - Create a new tool configuration
router.post('/', utilityController.createTool);

// POST /api/tools/:id/execute - Execute a tool
router.post('/:id/execute', utilityController.executeTool);

export default router; 