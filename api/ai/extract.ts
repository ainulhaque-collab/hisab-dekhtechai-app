import express from 'express';
import { createAIRouter } from '../../server/ai/http';
import { aiOptionsFromEnvironment } from '../../server/ai/runtime';

// Vercel Node function: same authenticated route as local development.
const app = express();
app.disable('x-powered-by');
app.use('/api/ai', createAIRouter(aiOptionsFromEnvironment(process.env)));
export default app;
