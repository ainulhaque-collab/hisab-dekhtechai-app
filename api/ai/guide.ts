import express from 'express';
import { createAIRouter } from '../../server/ai/http.js';
import { aiOptionsFromEnvironment } from '../../server/ai/runtime.js';
const app=express();app.disable('x-powered-by');
app.use('/api/ai',createAIRouter(aiOptionsFromEnvironment(process.env)));
export default app;
