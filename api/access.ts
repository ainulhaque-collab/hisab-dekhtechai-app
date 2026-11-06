import express from 'express';
import { createAccessRouter } from '../server/access/http.js';
import { accessOptionsFromEnvironment } from '../server/access/runtime.js';
const app=express();app.disable('x-powered-by');app.use('/api/access',createAccessRouter(accessOptionsFromEnvironment(process.env)));
export default app;
