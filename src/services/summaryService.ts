/**
 * @fileoverview
 * This service is responsible for summarizing large API tool execution results
 * to protect the LLM's context window while providing meaningful feedback.
 */
import { ApiToolExecutionResult } from '@agent-base/types';

const MAX_ARRAY_ITEMS_FOR_PREVIEW = 3;
const MAX_PREVIEW_LENGTH = 750;

/**
 * Summarizes the result of an API tool execution if it's too large.
 *
 * @param result - The full result object from the tool execution.
 * @returns The original result if it's small enough, otherwise a summarized version.
 */
export function summarizeApiResult(result: ApiToolExecutionResult): ApiToolExecutionResult {
  if (result === null || result === undefined) {
    return result;
  }

  // Case 1: Data is an array
  if (Array.isArray(result)) {
    // If stringifying the array is short, return it as is.
    if (JSON.stringify(result).length <= MAX_PREVIEW_LENGTH) {
      return result;
    }
    const summary = {
      summary: `The tool returned an array with ${result.length} items. Here is a preview of the first ${Math.min(result.length, MAX_ARRAY_ITEMS_FOR_PREVIEW)}.`,
      preview: result.slice(0, MAX_ARRAY_ITEMS_FOR_PREVIEW),
      fullResultSaved: true,
    };
    return summary;
  }

  // Case 2: Data is a Base64 encoded file
  if (typeof result === 'object' && (result as any).encoding === 'base64') {
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
  
  // Case 3: Data is an object or a string
  if (typeof result === 'object' || typeof result === 'string') {
      const contentString = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      if (contentString.length > MAX_PREVIEW_LENGTH) {
        let summaryText = `The tool returned a large text content (${contentString.length} characters). Here is a preview.`;
        if (typeof result === 'object' && result !== null) {
            summaryText = `The tool returned a large JSON object. Here is a preview.`;
        }
        
        const summary = {
            summary: summaryText,
            preview: `${contentString.substring(0, MAX_PREVIEW_LENGTH)}...`,
            fullResultSaved: true,
        };
        return summary;
      }
  }

  // If none of the above conditions are met, the data is small enough to be returned as is.
  return result;
} 