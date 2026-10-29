import { Router,json } from 'express';
import { AIServiceError } from '../ai/googleIdentity.js';
import { ContentError,type ContentStore } from './store.js';
import { contentId,validateContentDraft } from '../../src/content/contracts.js';

export interface ContentOptions {enabled:boolean;allowedOrigins:Set<string>;verifyToken:(token:string)=>Promise<{ownerHash:string;isAdmin:boolean}>;store?:ContentStore}
export function createContentRouter(options:ContentOptions){
  const router=Router();
  router.use((request,response,next)=>{
    response.set({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    const origin=request.get('origin');if(origin&&!options.allowedOrigins.has(origin)){response.status(403).json({error:'CONTENT_ORIGIN_DENIED'});return;}
    if(origin){response.set('Access-Control-Allow-Origin',origin);response.vary('Origin');}
    if(request.method==='OPTIONS'){response.set({'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});response.status(204).end();return;}
    next();
  });
  router.get('/articles',async(_request,response)=>{
    if(!options.enabled||!options.store){response.status(503).json({error:'CONTENT_NOT_CONFIGURED'});return;}
    try{response.json({articles:await options.store.listPublished()});}catch{response.status(503).json({error:'CONTENT_UNAVAILABLE'});}
  });
  router.post('/content',(request,response,next)=>{
    if(!request.is('application/json')||request.get('content-encoding')&&request.get('content-encoding')!=='identity'){response.status(415).json({error:'CONTENT_REQUEST_INVALID'});return;}next();
  },json({limit:'24kb',strict:true,inflate:false}),async(request,response)=>{
    try{
      const bearer=request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];if(!bearer)throw new ContentError('CONTENT_AUTH_REQUIRED',401);
      const identity=await options.verifyToken(bearer),body=request.body;
      const allowed:Record<string,string[]>={status:['action','ownerHash'],list:['action','ownerHash'],save:['action','ownerHash','requestId','id','document','expectedRevision']};
      if(!body||typeof body!=='object'||Array.isArray(body)||!Object.hasOwn(allowed,body.action)||Object.keys(body).length!==allowed[body.action].length||Object.keys(body).some(key=>!allowed[body.action].includes(key)))throw new ContentError('CONTENT_REQUEST_INVALID',400);
      if(body.ownerHash!==identity.ownerHash)throw new ContentError('CONTENT_OWNER_MISMATCH',403);
      if(body.action==='status'){response.json({isAdmin:identity.isAdmin,configured:!!(options.enabled&&options.store),broadcastEnabled:false});return;}
      if(!identity.isAdmin)throw new ContentError('CONTENT_ADMIN_REQUIRED',403);
      if(!options.enabled||!options.store)throw new ContentError('CONTENT_NOT_CONFIGURED');
      if(body.action==='list'){response.json({documents:await options.store.listDrafts()});return;}
      if(!contentId(body.requestId)||!contentId(body.id)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=1_000_000)throw new ContentError('CONTENT_REQUEST_INVALID',400);
      let draft;try{draft=validateContentDraft(body.document);}catch{throw new ContentError('CONTENT_REQUEST_INVALID',400);}
      response.json({document:await options.store.save(identity.ownerHash,body.requestId,body.id,draft,body.expectedRevision)});
    }catch(error){
      if(error instanceof ContentError){response.status(error.status).json({error:error.code});return;}
      if(error instanceof AIServiceError){response.status(error.status).json({error:error.status===401?'CONTENT_AUTH_REQUIRED':'CONTENT_AUTH_UNAVAILABLE'});return;}
      response.status(503).json({error:'CONTENT_UNAVAILABLE'});
    }
  });
  router.all(['/content','/articles'],(_request,response)=>{response.set('Allow','GET, POST, OPTIONS');response.status(405).json({error:'CONTENT_METHOD_NOT_ALLOWED'});});
  router.use((_error:unknown,_request:any,response:any,_next:unknown)=>{response.status(400).json({error:'CONTENT_REQUEST_INVALID'});});
  return router;
}
