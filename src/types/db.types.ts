/**
 * Database Record Type Definitions for API Tool Backend
 *
 * Defines TypeScript interfaces for the structure of records
 * retrieved from or inserted into the database tables.
 * Uses snake_case for field names corresponding to table columns where applicable,
 * though in this specific schema, most naturally align with camelCase in JS/TS.
 */

import { UtilityInputSecret, ApiToolStatus, UtilityProvider } from "@agent-base/types";

import { OpenAPIObject } from "openapi3-ts/oas30";

export interface UserApiToolRecord {
    user_id: string;
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
 embedding?: number[]; // Assuming numeric vector, adjust if needed
 created_at: Date;
 updated_at: Date;
} 

export interface ApiToolExecutionRecord {
    id: string;
    api_tool_id: string;
    user_id: string;
    input: any;
    output: any;
    status_code: number;
    error?: string;
    error_details?: string;
    hint?: string;
    created_at: Date;
    updated_at: Date;
}
