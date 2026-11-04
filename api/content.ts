import express from 'express';
import { createContentRouter } from '../server/content/http.js';
import { contentOptionsFromEnvironment } from '../server/content/runtime.js';
const app=express();app.disable('x-powered-by');
app.use('/api',createContentRouter(contentOptionsFromEnvironment(process.env)));
export default app;
