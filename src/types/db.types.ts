/**
 * Database Record Type Definitions for API Tool Backend
 *
 * Defines TypeScript interfaces for the structure of records
 * retrieved from or inserted into the database tables.
 * Uses snake_case for field names corresponding to table columns where applicable,
 * though in this specific schema, most naturally align with camelCase in JS/TS.
 */

import { UtilityInputSecret, ApiToolStatus, UtilityProvider, ApiTool, UserApiTool, ApiToolExecution } from "@agent-base/types";

import { OpenAPIObject } from "openapi3-ts/oas30";

export interface UserApiToolRecord {
    user_id: string;
    organization_id: string;
    api_tool_id: string;
    status: ApiToolStatus;
    created_at: Date;
    updated_at: Date;
}

/**
 * Represents the structure of a record in the 'api_tools' table.
 */
export interface ApiToolRecord {
  id: string; // UUID, primary key
  name: string;
  description: string;
  utility_provider: UtilityProvider;
  openapi_specification: OpenAPIObject;
  security_option: string;
  security_secrets: { // The secrets to use for the operation
    "x-secret-name": UtilityInputSecret,
    "x-secret-username": UtilityInputSecret,
    "x-secret-password": UtilityInputSecret,
 };
 is_verified: boolean;
 creator_user_id: string;
 creator_organization_id: string;
 embedding?: number[]; // Assuming numeric vector, adjust if needed
 created_at: Date;
 updated_at: Date;
} 

export interface ApiToolExecutionRecord {
    id: string;
    api_tool_id: string;
    user_id: string;
    organization_id: string;
    input: any;
    output: any;
    status_code: number;
    error?: string;
    error_details?: string;
    hint?: string;
    created_at: Date;
    updated_at: Date;
}

// Helper function to map database row to ApiToolRecord (handles potential snake_case to camelCase if any)
// For now, field names in db.types.ts mostly match, but this is good practice.
export const mapRowToApiTool = (row: any): ApiTool => {
  return {
      id: row.id,
      name: row.name,
      description: row.description,
      utilityProvider: row.utility_provider,
      openapiSpecification: row.openapi_specification,
      securityOption: row.security_option,
      securitySecrets: row.security_secrets,
      isVerified: row.is_verified,
      creatorUserId: row.creator_user_id,
      // @ts-ignore - creatorOrganizationId is in the ApiTool type
      creatorOrganizationId: row.creator_organization_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
  };
};

// Corrected helper function to map database row to UserApiToolRecord
export const mapRowToUserApiTool = (row: any): UserApiTool => {
  return {
      userId: row.user_id,
      organizationId: row.organization_id,
      apiToolId: row.api_tool_id,
      status: row.status as ApiToolStatus, // Ensure this matches the enum values, e.g., 'unset', 'active'
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
  };
};

/**
 * Helper function to map a database row to an ApiToolExecution object.
 * Handles parsing of JSON string fields (input, output) and Date conversions.
 * @param {any} row - The database row.
 * @returns {ApiToolExecutionRecord} The mapped ApiToolExecution object.
 */
export const mapRowToApiToolExecution = (row: any): ApiToolExecution => {
  let parsedInput = row.input;
  if (typeof row.input === 'string') {
      try {
          parsedInput = JSON.parse(row.input);
      } catch (e) {
          console.warn('Failed to parse input JSON string from DB:', e);
          // Keep as string if parsing fails, or handle as an error
      }
  }

  let parsedOutput = row.output;
  if (typeof row.output === 'string') {
      try {
          parsedOutput = JSON.parse(row.output);
      } catch (e) {
          console.warn('Failed to parse output JSON string from DB:', e);
           // Keep as string if parsing fails, or handle as an error
      }
  }

  return {
      id: row.id,
      apiToolId: row.api_tool_id,
      userId: row.user_id,
      organizationId: row.organization_id,
      input: parsedInput,
      output: parsedOutput,
      statusCode: row.status_code,
      error: row.error,
      errorDetails: row.error_details,
      hint: row.hint,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
  };
};

