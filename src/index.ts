import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import utilityRoutes from './routes/utilityRoutes';
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

// Initialize Express
const app: express.Express = express();
const port = process.env.PORT;

// Middlewares
app.use(express.json()); // Parse JSON bodies

// Routes
// Mount utility routes directly at the root path '/'
app.use('/', utilityRoutes);

// Global Error Handler (very basic)
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).json({ success: false, error: 'Internal Server Error', details: err.message });
});

app.listen(port, () => {
  console.log(`⚙️ External Utility Tool Service listening on port ${port}`);
}); 