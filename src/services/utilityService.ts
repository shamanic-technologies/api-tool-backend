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
        console.warn(`${logPrefix} OPENAI_API_KEY not found in environment variables. Skipping embedding generation.`);
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
        console.log(`${logPrefix} Generating embedding for OpenAPI spec: ${openapiSpec.info.title}`);
        const inputString = JSON.stringify(openapiSpec);
        
        // At this point, openaiClient should be initialized if an API key was provided.
        // The check at the beginning of the function handles the missing API key scenario.
        const response = await openaiClient.embeddings.create({
            model: 'text-embedding-3-small',
            input: inputString,
        });

        if (response.data && response.data.length > 0 && response.data[0].embedding) {
            console.log(`${logPrefix} Embedding generated successfully for: ${openapiSpec.info.title}`);
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
export const listAvailableTools = async (): Promise<UtilitiesList> => {
    const toolRecords = await getAllApiTools(); 
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
        // @ts-ignore - creatorOrganizationId is in the ApiTool type
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
