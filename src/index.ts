import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { GoogleSecretManager } from '@agent-base/secret-client';
import utilityRoutes from './routes/utilityRoutes.js';
import path from 'path';
import fs from 'fs';


// Load environment variables based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';

// Only load from .env file in development
if (nodeEnv === 'development') {
  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    console.log('🔧 Loading development environment from .env');
    dotenv.config({ path: envFile });
  } else {
    console.log(`Environment file ${envFile} not found, using default environment variables.`);
  }
} else {
  console.log('🚀 Production environment detected, using configured environment variables.');
}

// --- GSM Client (to be initialized) ---
export let gsmClient: GoogleSecretManager;

async function prepareGcpCredentials() {
    const credsContent = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsContent && credsContent.trim().startsWith('{')) {
        console.log('GOOGLE_APPLICATION_CREDENTIALS appears to be JSON content. Writing to temporary file...');
        try {
            const tempDir = '/tmp';
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const tempCredPath = path.join(tempDir, 'gcp_creds.json');
            fs.writeFileSync(tempCredPath, credsContent);
            process.env.GOOGLE_APPLICATION_CREDENTIALS = tempCredPath;
            console.log(`Credentials written to ${tempCredPath} and GOOGLE_APPLICATION_CREDENTIALS updated.`);
        } catch (error) {
            console.error('FATAL ERROR: Failed to write GOOGLE_APPLICATION_CREDENTIALS content to temporary file:', error);
            process.exit(1);
        }
    } else if (credsContent) {
        console.log('GOOGLE_APPLICATION_CREDENTIALS appears to be a file path. Using as is.');
    } else {
        console.warn('GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. Attempting to use Application Default Credentials.');
    }
}

// --- Initialization Function ---
async function initializeConfig() {
    console.log('🔧 Initializing configuration for Secret Manager...');
    await prepareGcpCredentials(); // Prepare credentials before initializing client

    const projectId = process.env.GOOGLE_PROJECT_ID;
    if (!projectId) {
        console.error("FATAL ERROR: GOOGLE_PROJECT_ID environment variable is not set.");
        process.exit(1);
    }

    try {
        gsmClient = new GoogleSecretManager({
            projectId: projectId,
        });
        console.log('✅ GoogleSecretManager initialized successfully.');
    } catch (error) {
        console.error('FATAL ERROR: Could not initialize GoogleSecretManager:', error);
        process.exit(1);
    }

    // Example: You might want to load an essential API key or configuration at startup
    // For now, we just initialize the client.
    // try {
    //     const essentialSecret = await gsmClient.getSecret('api-tool-essential-secret');
    //     if (!essentialSecret) {
    //         console.warn("Essential secret 'api-tool-essential-secret' not found in GSM.");
    //         // Depending on your needs, you might exit, or try to create it, or operate without it.
    //     } else {
    //         console.log("Essential secret 'api-tool-essential-secret' loaded successfully.");
    //     }
    // } catch (error) {
    //     console.error('Error fetching essential secret:', error);
    //     // Handle appropriately
    // }
}

// Initialize Express
const app: express.Express = express();
const port = process.env.PORT;

// Middlewares
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON bodies

// ===== HEALTH CHECK ROUTE =====
app.get('/health', (req: Request, res: Response) => {
  console.log('[API Tool Service] Received request for /health');
  res.status(200).json({ success: true, status: 'healthy', message: 'Api Tool Service is running' });
});
// ============================

// Routes
// Mount utility routes under '/api/tools' path
app.use('/api/v1', utilityRoutes);

// Global Error Handler (very basic)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).json({ success: false, error: 'Internal Server Error', details: err.message });
});

// Initialize configuration and then start the server
initializeConfig().then(() => {
    app.listen(port, () => {
        console.log(`⚙️ Api Tool Service listening on port ${port}`);
    });
}).catch(error => {
    console.error("Failed to initialize configuration:", error);
    process.exit(1);
}); 