import { next } from '@vercel/functions';
import { nativeSurfaceResponse } from './server/access/nativeSurface.js';
export default function proxy(request:Request){return nativeSurfaceResponse(request)??next();}
