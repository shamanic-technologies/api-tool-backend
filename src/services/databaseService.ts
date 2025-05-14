import fs from 'fs/promises';
import path from 'path';
import { ExternalUtilityTool, UtilitiesList } from '@agent-base/types';

// Path to the mock database file
const UTILITIES_DB_PATH = path.join(__dirname, '../data/utilities.json');

/**
 * Writes the provided utility configurations to the JSON file.
 * Creates the file if it doesn't exist.
 * @param {ExternalUtilityTool[]} utilities The array of utility configs to write.
 * @returns {Promise<void>}
 * @throws {Error} If the file cannot be written.
 */
export const writeUtilities = async (utilities: ExternalUtilityTool[]): Promise<void> => {
    try {
        // Ensure directory exists (optional, depending on setup)
        // await fs.mkdir(path.dirname(UTILITIES_DB_PATH), { recursive: true });
        await fs.writeFile(UTILITIES_DB_PATH, JSON.stringify(utilities, null, 2), 'utf-8');
    } catch (error) {
        console.error("Error writing utilities file:", error);
        throw new Error('Could not save utilities configuration.');
    }
};

/**
 * Reads the utility configurations from the JSON file.
 * Creates the file with an empty array if it doesn't exist.
 * @returns {Promise<ExternalUtilityTool[]>} A promise resolving to the array of utility configs.
 * @throws {Error} If the file cannot be read (other than not existing initially).
 */
export const readUtilities = async (): Promise<ExternalUtilityTool[]> => {
    try {
        const data = await fs.readFile(UTILITIES_DB_PATH, 'utf-8');
        // Ensure JSON.parse handles empty strings gracefully if needed, though writeUtilities should prevent this.
        return JSON.parse(data || '[]') as ExternalUtilityTool[]; 
    } catch (error) {
        // If file doesn't exist, create it with an empty array and return the empty array
        if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(`Utilities file not found at ${UTILITIES_DB_PATH}, creating it.`);
            try {
                await writeUtilities([]); // Create the file with an empty array
                return [];
            } catch (writeError) {
                console.error("Error creating utilities file:", writeError);
                throw new Error('Could not create utilities configuration file.');
            }
        }
        // For other read errors, log and throw
        console.error("Error reading utilities file:", error);
        throw new Error('Could not read utilities configuration.');
    }
}; 