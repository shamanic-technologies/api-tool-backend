/**
 * PostgreSQL Database Connection Setup
 *
 * Initializes and exports a connection pool for interacting with the PostgreSQL database.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Validate that DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('FATAL ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1); // Exit if the database URL is missing
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration if needed for production environments
  // ssl: {
  //   rejectUnauthorized: false // Example for Heroku, adjust as needed
  // }
});

pool.on('connect', () => {
  console.log('Successfully connected to the PostgreSQL database.');
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Executes a SQL query using the connection pool.
 *
 * @param text The SQL query string (can include placeholders like $1, $2)
 * @param params An array of parameters to substitute into the query string
 * @returns A Promise resolving to the query result
 */
export const query = <T extends pg.QueryResultRow>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> => {
  return pool.query<T>(text, params);
};

/**
 * Exports the connection pool directly for more complex transactions or direct access if needed.
 */
export { pool }; 