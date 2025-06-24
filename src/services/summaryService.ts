/**
 * @fileoverview
 * This service is responsible for summarizing large API tool execution results
 * to protect the LLM's context window while providing meaningful feedback.
 */
import { ApiToolExecutionResult, ServiceResponse } from '@agent-base/types';

const MAX_ARRAY_ITEMS_FOR_PREVIEW = 3;
const MAX_STRING_LENGTH_FOR_PREVIEW = 500;

/**
 * Summarizes the result of an API tool execution if it's too large.
 *
 * @param result - The full result object from the tool execution.
 * @returns The original result if it's small enough, otherwise a summarized version.
 */
export function summarizeApiResult(result: ApiToolExecutionResult): ApiToolExecutionResult {

  // Case 1: Data is an array
  if (Array.isArray(result)) {
    if (result.length > MAX_ARRAY_ITEMS_FOR_PREVIEW) {
      const summary = {
        summary: `The tool returned an array with ${result.length} items. Here are the first ${MAX_ARRAY_ITEMS_FOR_PREVIEW}.`,
        preview: result.slice(0, MAX_ARRAY_ITEMS_FOR_PREVIEW),
        fullResultSaved: true,
      };
      return summary;
    }
  }

  // Case 2: Data is a long string
  else if (typeof result === 'string') {
    if (result.length > MAX_STRING_LENGTH_FOR_PREVIEW) {
      const summary = {
        summary: `The tool returned a large text content (${result.length} characters). Here is the beginning.`,
        preview: `${result.substring(0, MAX_STRING_LENGTH_FOR_PREVIEW)}...`,
        fullResultSaved: true,
      };
      return summary;
    }
  }

  // Case 3: Data is a Base64 encoded file
  else if (typeof result === 'object' && result !== null && (result as any).encoding === 'base64') {
    const dataAsBase64 = result as any;
    const summary = {
      summary: `The tool successfully downloaded a file.`,
      fileInfo: {
        contentType: dataAsBase64.contentType,
        sizeInBytes: dataAsBase64.content.length, // Note: Base64 string length is ~33% larger than binary
      },
      fullResultSaved: true,
    };
    return summary;
  }
  
  // Case 4: Data is a large object (not an array)
  else if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      const jsonString = JSON.stringify(result);
      if(jsonString.length > MAX_STRING_LENGTH_FOR_PREVIEW) {
        const summary = {
            summary: `The tool returned a large JSON object. Here is a summary of its keys.`,
            keys: Object.keys(result),
            fullResultSaved: true,
        };
        return summary;
      }
  }

  // If none of the above conditions are met, the data is small enough to be returned as is.
  return result;
} 