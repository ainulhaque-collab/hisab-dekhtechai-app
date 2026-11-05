import { Router,json } from 'express';
import { AccessError,type ServiceCustomer } from './identity.js';
import type { PostgresAccessStore } from './store.js';

export interface AccessOptions {enabled:boolean;allowedOrigins:Set<string>;verify?:(token:string)=>Promise<ServiceCustomer>;store?:PostgresAccessStore}
export function createAccessRouter(options:AccessOptions){
  const router=Router();
  router.use((request,response,next)=>{
    response.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    const origin=request.get('origin');if(origin&&!options.allowedOrigins.has(origin)){response.status(403).json({error:'ACCESS_ORIGIN_DENIED'});return;}
    if(origin){response.set('Access-Control-Allow-Origin',origin);response.vary('Origin');}
    if(request.method==='OPTIONS'){response.set({'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'});response.status(204).end();return;}next();
  });
  router.post('/',(request,response,next)=>{
    if(!options.enabled||!options.verify||!options.store){response.status(503).json({error:'ACCESS_NOT_CONFIGURED'});return;}
    if(!request.is('application/json')||request.get('content-encoding')&&request.get('content-encoding')!=='identity'){response.status(415).json({error:'ACCESS_REQUEST_INVALID'});return;}next();
  },json({limit:'8kb',strict:true,inflate:false}),async(request,response)=>{
    try{
      const token=request.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];if(!token)throw new AccessError('ACCESS_SIGN_IN_REQUIRED',401);
      const customer=await options.verify!(token),body=request.body,store=options.store!;
      await store.checkRate(customer);
      if(!body||typeof body!=='object'||Array.isArray(body))throw new AccessError('ACCESS_REQUEST_INVALID');
      const fields:Record<string,string[]>={status:['action'],redeem:['action','requestId','code'],issue:['action','requestId','days'],
        grant:['action','requestId','customerId','days'],block:['action','requestId','customerId'],unblock:['action','requestId','customerId'],
        providerStatus:['action'],configureProvider:['action','requestId','model','apiKey','expectedRevision'],disableProvider:['action','requestId'],
        directory:['action','search','cursor','filter'],grantEmails:['action','requestId','emails','days'],manageMany:['action','requestId','customerIds','operation'],cancelEmailGrant:['action','requestId','grantId','email']};
      const allowed=fields[body.action];if(!allowed||Object.keys(body).length!==allowed.length||Object.keys(body).some(key=>!allowed.includes(key)))throw new AccessError('ACCESS_REQUEST_INVALID');
      switch(body.action){
        case 'status':response.json(await store.status(customer));break;
        case 'redeem':response.json(await store.redeem(customer,body.requestId,body.code));break;
        case 'issue':response.json(await store.issue(customer,body.requestId,body.days));break;
        case 'grant':case 'block':case 'unblock':response.json(await store.manage(customer,body.requestId,body.customerId,body.action,body.days));break;
        case 'providerStatus':response.json(await store.providerStatus(customer));break;
        case 'configureProvider':response.json(await store.configureProvider(customer,body.requestId,body.model,body.apiKey,body.expectedRevision));break;
        case 'disableProvider':response.json(await store.disableProvider(customer,body.requestId));break;
        case 'directory':response.json(await store.directory.list(customer,body.search,body.cursor,body.filter));break;
        case 'grantEmails':response.json(await store.directory.grant(customer,body.requestId,body.emails,body.days));break;
        case 'manageMany':response.json(await store.directory.manage(customer,body.requestId,body.customerIds,body.operation));break;
        case 'cancelEmailGrant':response.json(await store.directory.cancel(customer,body.requestId,body.grantId,body.email));break;
      }
    }catch(error){response.status(error instanceof AccessError?error.status:503).json({error:error instanceof AccessError?error.code:'ACCESS_UNAVAILABLE'});}
  });
  router.all('/',(_request,response)=>{response.set('Allow','POST, OPTIONS');response.status(405).json({error:'ACCESS_METHOD_NOT_ALLOWED'});});
  router.use((_error:unknown,_request:unknown,response:import('express').Response,_next:unknown)=>{response.status(400).json({error:'ACCESS_REQUEST_INVALID'});});
  return router;
}
