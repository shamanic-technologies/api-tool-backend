import { OpenAPIObject, OperationObject } from 'openapi3-ts/oas30';

/**
 * Extracts the single operation from the OpenAPI specification.
 * Assumes the spec is pre-validated to contain exactly one path and one method.
 * @param {OpenAPIObject} openapiSpec The OpenAPI specification.
 * @param {string} logPrefix Logging prefix.
 * @returns {OperationObject | null} The operation object or null if not found.
 */
export const getOperation = (openapiSpec: OpenAPIObject, logPrefix: string): OperationObject | null => {
    if (!openapiSpec.paths) {
        console.warn(`${logPrefix} OpenAPI spec is missing 'paths'.`);
        return null;
    }
    const pathKeys = Object.keys(openapiSpec.paths);
    if (pathKeys.length !== 1) {
        console.warn(`${logPrefix} OpenAPI spec 'paths' should contain exactly one path, found ${pathKeys.length}.`);
        return null;
    }
    const pathItem = openapiSpec.paths[pathKeys[0]];
    if (!pathItem) {
        console.warn(`${logPrefix} OpenAPI spec path item for '${pathKeys[0]}' is undefined.`);
        return null;
    }

    const methodKeys = Object.keys(pathItem).filter(key => [
        'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'
    ].includes(key.toLowerCase()));

    if (methodKeys.length !== 1) {
        console.warn(`${logPrefix} OpenAPI spec path item should contain exactly one HTTP method, found ${methodKeys.length}.`);
        return null;
    }
    const operation = pathItem[methodKeys[0] as keyof typeof pathItem] as OperationObject;
    if (!operation || typeof operation !== 'object') {
        console.warn(`${logPrefix} OpenAPI spec operation for '${methodKeys[0]}' is invalid.`);
        return null;
    }
    return operation;
}; 