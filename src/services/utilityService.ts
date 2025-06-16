import {
    ApiTool,
    UtilityProvider,
    ApiToolData,
    ApiToolInfo,
    CreateApiToolRequest,
    UtilitiesList,
} from '@agent-base/types';
import { JSONSchema7 } from 'json-schema';
import {
    createApiTool,
    getApiToolById,
    getAllApiTools,
    renameApiTool as renameApiToolInDb,
    deleteApiTool as deleteApiToolInDb,
    updateApiTool as updateApiToolInDb,
} from './databaseService.js';
import {
    getOperation,
    deriveSchemaFromOperation,
} from './utils.js';
import OpenAI from 'openai';
import { OpenAPIObject } from 'openapi3-ts/oas30';

/**
 * @file Utility Service
 * @description Handles business logic for API tools, including listing, details, creation, and execution orchestration.
 * Uses databaseService for data persistence.
 */

// Declare openaiClient, to be initialized lazily when needed
let openaiClient: OpenAI | null = null;

/**
 * Generates an embedding for the given OpenAPI specification using OpenAI.
 * @param {OpenAPIObject} openapiSpec - The OpenAPI specification object.
 * @returns {Promise<number[] | undefined>} The embedding vector or undefined if an error occurs.
 */
const generateOpenAIEmbedding = async (openapiSpec: OpenAPIObject): Promise<number[] | undefined> => {
    const logPrefix = '[UtilityService GenerateEmbedding]';

    if (!process.env.OPENAI_API_KEY) {
        console.error(`${logPrefix} OPENAI_API_KEY not found in environment variables. Skipping embedding generation.`);
        return undefined;
    }

    // Initialize client if it hasn't been already
    if (!openaiClient) {
        try {
            openaiClient = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
        } catch (initError) {
            console.error(`${logPrefix} Failed to initialize OpenAI client:`, initError);
            return undefined; // Cannot proceed without a client
        }
    }

    try {
        const inputString = JSON.stringify(openapiSpec);
        
        // At this point, openaiClient should be initialized if an API key was provided.
        // The check at the beginning of the function handles the missing API key scenario.
        const response = await openaiClient.embeddings.create({
            model: 'text-embedding-3-small',
            input: inputString,
        });

        if (response.data && response.data.length > 0 && response.data[0].embedding) {
            return response.data[0].embedding;
        } else {
            console.error(`${logPrefix} Failed to generate embedding. No embedding data in response for: ${openapiSpec.info.title}`);
            return undefined;
        }
    } catch (error) {
        console.error(`${logPrefix} Error generating OpenAI embedding for ${openapiSpec.info.title}:`, error);
        return undefined; // Return undefined on error
    }
};

/**
 * Service function to list available API tools (summary: ID, name, description).
 * @returns {Promise<ApiToolList>} A list of API tool summaries.
 */
export const listAvailableTools = async (userId: string, organizationId: string): Promise<UtilitiesList> => {
    const toolRecords = await getAllApiTools(userId, organizationId); 
    return toolRecords.map((tool: ApiTool) => ({ // Add any type for tool
        id: tool.id,
        name: tool.name,
        description: tool.description,
    }));
};

/**
 * Service function to get detailed information about a specific API tool.
 * This includes deriving the JSONSchema7 for its parameters from the OpenAPI spec.
 * @param {string} toolId The ID of the tool.
 * @returns {Promise<ApiToolInfo | null>} Detailed tool information or null if not found.
 */
export const getToolDetails = async (toolId: string): Promise<ApiToolInfo | null> => {
    const logPrefix = `[UtilityService GetToolDetails ${toolId}]`;
    const tool = await getApiToolById(toolId); // Fetches ApiTool | null
    if (!tool) return null;

    // Use direct name and description from the tool object
    const toolName = tool.name;
    const toolDescription = tool.description;

    const operation = getOperation(tool.openapiSpecification, logPrefix);
    if (!operation) {
        console.error(`${logPrefix} Could not extract operation to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: toolName,
            description: toolDescription,
            utilityProvider: tool.utilityProvider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed due to invalid operation in OpenAPI spec' } as JSONSchema7,
        };
    }

    const derivedSchema = deriveSchemaFromOperation(operation, tool.openapiSpecification, logPrefix);
    if (!derivedSchema) {
        console.error(`${logPrefix} Failed to derive schema for ApiToolInfo.`);
        return {
            id: tool.id,
            name: toolName,
            description: toolDescription,
            utilityProvider: tool.utilityProvider,
            schema: { type: 'object', properties: {}, description: 'Schema derivation failed' } as JSONSchema7,
        };
    }

    const toolInfo: ApiToolInfo = {
        id: tool.id,
        name: toolName,
        description: toolDescription,
        utilityProvider: tool.utilityProvider,
        schema: derivedSchema,
    };
    return toolInfo;
};

/**
 * Service function to add a new API tool configuration.
 * @param {CreateApiToolRequest} toolCreationData - The data for the new API tool.
 * @returns {Promise<ApiTool>} The added API tool, mapped from ApiToolRecord.
 * @throws {Error} If creation fails.
 */
export const addNewTool = async (toolCreationData: CreateApiToolRequest): Promise<ApiTool> => {
    // ID is auto-generated by DB. We don't check for existing ID before creation.
    // Uniqueness constraints (e.g., on tool name for a user) should be handled by DB schema if needed.
    
    // Generate embedding for the OpenAPI specification
    const embedding = await generateOpenAIEmbedding(toolCreationData.openapiSpecification);

    // Prepare data for the database, now including the optional embedding
    const toolDataForDb: ApiToolData = {
        name: toolCreationData.name,
        description: toolCreationData.description,
        utilityProvider: toolCreationData.utilityProvider,
        openapiSpecification: toolCreationData.openapiSpecification,
        securityOption: toolCreationData.securityOption,
        securitySecrets: toolCreationData.securitySecrets,
        isVerified: toolCreationData.isVerified === undefined ? false : toolCreationData.isVerified,
        creatorUserId: toolCreationData.creatorUserId,
        creatorOrganizationId: toolCreationData.creatorOrganizationId,
    };

    try {
        // Pass the complete data (including potential embedding) to createApiTool.
        // The createApiTool function in databaseService.ts is already prepared to handle this.
        const createdTool: ApiTool = await createApiTool(toolDataForDb, embedding as number[]);
        return createdTool;
    } catch (error) {
        console.error('Error in addNewTool service:', error);
        // Rethrow or handle as specific error type if preferred
        if (error instanceof Error) {
            throw new Error(`Failed to add new tool: ${error.message}`);
        }
        throw new Error('Failed to add new tool due to an unknown error.');
    }
};

/**
 * Renames a specific API tool, ensuring the user is the creator.
 * @param toolId The ID of the tool to rename.
 * @param newName The new name for the tool.
 * @param userId The ID of the user requesting the rename.
 * @param organizationId The ID of the user's organization.
 * @returns The updated API tool.
 * @throws An error if the tool is not found, the user is not the owner, or the update fails.
 */
export const renameTool = async (toolId: string, newName: string, userId: string, organizationId: string): Promise<ApiTool> => {
    const logPrefix = `[UtilityService RenameTool ${toolId}]`;

    // First, verify the tool exists and the user is the owner.
    // This is implicitly handled by the `renameApiToolInDb` function's WHERE clause,
    // but an explicit check can provide clearer error messages.
    const tool = await getApiToolById(toolId);
    if (!tool) {
        throw new Error('Tool not found.');
    }

    if (tool.creatorUserId !== userId) {
        console.warn(`${logPrefix} User ${userId} attempted to rename tool owned by ${tool.creatorUserId}.`);
        throw new Error('Forbidden: You do not have permission to rename this tool.');
    }

    if (tool.creatorOrganizationId !== organizationId) {
        console.error(`${logPrefix} User from organization ${organizationId} attempted to rename tool owned by organization ${tool.creatorOrganizationId}.`);
        throw new Error('Forbidden: You do not have permission to rename this tool.');
    }

    const renamedTool = await renameApiToolInDb(toolId, newName, userId, organizationId);

    if (!renamedTool) {
        // This case should ideally not be reached if the above checks pass,
        // but it's a safeguard against race conditions or other issues.
        console.error(`${logPrefix} Failed to rename tool in database, despite passing checks.`);
        throw new Error('Failed to update tool name.');
    }

    return renamedTool;
};

/**
 * Deletes a specific API tool, ensuring the user is the creator.
 * @param toolId The ID of the tool to delete.
 * @param userId The ID of the user requesting the deletion.
 * @param organizationId The ID of the user's organization.
 * @returns A boolean indicating success.
 * @throws An error if the tool is not found, the user is not the owner, or the deletion fails.
 */
export const deleteTool = async (toolId: string, userId: string, organizationId: string): Promise<boolean> => {
    const logPrefix = `[UtilityService DeleteTool ${toolId}]`;

    const tool = await getApiToolById(toolId);
    if (!tool) {
        console.error(`${logPrefix} Tool not found.`);
        throw new Error('Tool not found.');
    }

    if (tool.creatorUserId !== userId) {
        console.error(`${logPrefix} User ${userId} attempted to delete tool owned by ${tool.creatorUserId}.`);
        throw new Error('Forbidden: You do not have permission to delete this tool.');
    }

    if (tool.creatorOrganizationId !== organizationId) {
        console.error(`${logPrefix} User from organization ${organizationId} attempted to delete tool owned by organization ${tool.creatorOrganizationId}.`);
        throw new Error('Forbidden: You do not have permission to delete this tool.');
    }

    const wasDeleted = await deleteApiToolInDb(toolId, userId, organizationId);

    if (!wasDeleted) {
        console.error(`${logPrefix} Failed to delete tool in database, despite passing checks.`);
        throw new Error('Failed to delete tool.');
    }

    return wasDeleted;
};

/**
 * Updates a specific API tool, ensuring the user is the creator.
 * @param toolId The ID of the tool to update.
 * @param updates The partial data to update the tool with.
 * @param userId The ID of the user requesting the update.
 * @param organizationId The ID of the user's organization.
 * @returns The updated API tool.
 * @throws An error if the tool is not found, the user is not the owner, or the update fails.
 */
export const updateTool = async (toolId: string, updates: Partial<ApiToolData>, userId: string, organizationId: string): Promise<ApiTool> => {
    const logPrefix = `[UtilityService UpdateTool ${toolId}]`;

    const tool = await getApiToolById(toolId);
    if (!tool) {
        console.error(`${logPrefix} Tool not found.`);
        throw new Error('Tool not found.');
    }

    if (tool.creatorUserId !== userId) {
        console.error(`${logPrefix} User ${userId} attempted to update tool owned by ${tool.creatorUserId}.`);
        throw new Error('Forbidden: You do not have permission to update this tool.');
    }

    if (tool.creatorOrganizationId !== organizationId) {
        console.error(`${logPrefix} User from organization ${organizationId} attempted to update tool owned by organization ${tool.creatorOrganizationId}.`);
        throw new Error('Forbidden: You do not have permission to update this tool.');
    }

    const updatedTool = await updateApiToolInDb(toolId, updates, userId, organizationId);

    if (!updatedTool) {
        console.error(`${logPrefix} Failed to update tool in database, despite passing checks.`);
        throw new Error('Failed to update tool.');
    }

    return updatedTool;
};
