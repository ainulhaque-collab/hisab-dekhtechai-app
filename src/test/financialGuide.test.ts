import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { type GuideInput,summaryForGuide,validateGuideInput,validateFinancialGuide,guideInputHash } from '../ai/financialGuide';
import { requestFinancialGuide } from '../ai/guideClient';
import { AIConsentStore } from '../ai/consent';
import { GeminiEntryProvider } from '../../server/ai/gemini';
import { AutomaticGeminiEntryProvider } from '../../server/ai/modelSelection';
import { createAIRouter } from '../../server/ai/http';
import { DevelopmentAIBudget } from '../../server/ai/budget';

const input:GuideInput={purpose:'gemini-financial-summary-v1',consent:true,language:'bn',from:'2026-10-01',to:'2026-10-29',incomeMinor:'1000000',expenseMinor:'10000',categories:[{label:'Food',amountMinor:'10000'}]};
const answer={observations:['Synthetic observation'],suggestions:['Synthetic optional step'],limitation:'Only this selected period was reviewed.'};
const owner='a'.repeat(64);

test('guide summary excludes individual finance records and bounds categories without losing any paisa',()=>{
  const report={from:input.from,to:input.to,incomeMinor:'900719925474099312345',expenseMinor:'10000',categories:Array.from({length:10},(_,i)=>({id:String(i),amountMinor:'1000'})),entries:[{note:'private',receipt:'private'}],workspaceId:'private',accountNumber:'private'};
  const summary=summaryForGuide(report,new Map(report.categories.map(category=>[category.id,'Category '+category.id])),'bn');
  assert.equal(summary.categories.length,8);assert.equal(summary.categories.at(-1)?.amountMinor,'3000');
  assert.doesNotMatch(JSON.stringify(summary),/private|workspace|receipt|entries|accountNumber/);
  assert.equal(summary.incomeMinor,report.incomeMinor);
  for(const raw of [{...input,consent:false},{...input,note:'injected'},{...input,expenseMinor:'0'},{...input,from:'2026-02-30'},{...input,categories:[{label:'Food',amountMinor:'1e4'}]}]) assert.throws(()=>validateGuideInput(raw),/AI_GUIDE_INPUT_INVALID/);
  assert.throws(()=>validateFinancialGuide({...answer,actions:[{transfer:'unsafe'}]}),/AI_RESPONSE_INVALID/);
});

test('receipt permission does not authorize a financial guide and each permission revokes independently',async()=>{
  const data=new Map<string,string>();const driver={getItem:async(key:string)=>data.get(key)||null,setItem:async(key:string,value:string)=>{data.set(key,value);},removeItem:async(key:string)=>{data.delete(key);}};
  const media=new AIConsentStore(driver),guide=new AIConsentStore(driver,'gemini-financial-summary-v1');
  await media.allow(owner);assert.equal(await guide.allowed(owner),false);
  await guide.allow(owner);await media.revoke(owner);assert.equal(await guide.allowed(owner),true);
  await guide.revoke(owner);assert.equal(await guide.allowed(owner),false);
});

test('Gemini guide makes one bounded structured call and never invokes ledger tools',async()=>{
  let calls=0;
  const provider=new GeminiEntryProvider({apiKey:'synthetic-not-a-live-key',model:'gemini-3.6-flash'},async request=>{
    calls++;assert.equal(request.config?.responseMimeType,'application/json');assert.equal(request.config?.httpOptions?.retryOptions?.attempts,1);
    assert.equal(request.config?.tools,undefined);assert.match(JSON.stringify(request.contents),/gemini-financial-summary-v1/);
    return {text:JSON.stringify(answer)};
  });
  const result=await provider.guide(input);assert.deepEqual(result.guide,answer);assert.equal(result.sourceSha256,guideInputHash(input));assert.equal(calls,1);
  const invalid=new GeminiEntryProvider({apiKey:'synthetic-not-a-live-key',model:'gemini-3.6-flash'},async()=>({text:'{"actions":["transfer"]}'}));
  await assert.rejects(invalid.guide(input),/AI_RESPONSE_INVALID/);
});

test('guide sends exact taka decimals and localized display strings while binding the original minor-unit summary',async()=>{
  for(const language of ['bn','en'] as const){
    const original:GuideInput={...input,language,incomeMinor:'900719925474099312345',expenseMinor:'12081',categories:[{label:'Food',amountMinor:'12080'},{label:'Other',amountMinor:'1'},{label:'Empty',amountMinor:'0'}]};
    const provider=new GeminiEntryProvider({apiKey:'synthetic-not-a-live-key',model:'gemini-3.6-flash'},async request=>{
      const contents=request.contents as {parts:{text:string}[]}[];
      const summary=JSON.parse(contents[0].parts[0].text);
      assert.equal(summary.currency,'BDT');assert.equal(summary.amountUnit,'taka');
      assert.equal(summary.income.amountDecimal,'9007199254740993123.45');
      assert.equal(summary.expense.amountDecimal,'120.81');
      assert.deepEqual(summary.categories.map((category:any)=>category.amountDecimal),['120.80','0.01','0.00']);
      assert.equal(summary.categories[0].display,language==='bn'?'১২০.৮০ টাকা (BDT)':'BDT 120.80');
      assert.doesNotMatch(JSON.stringify(summary),/amountMinor|incomeMinor|expenseMinor/);
      assert.match(String(request.config?.systemInstruction),/NOT paisa/);
      return {text:JSON.stringify(answer)};
    });
    const result=await provider.guide(original);
    assert.equal(result.sourceSha256,guideInputHash(original));assert.equal(original.categories[0].amountMinor,'12080');
  }
});

test('automatic Gemini guide shares the reviewed model selector and cools down a busy model without paid retries',async()=>{
  const chosen:string[]=[];
  const provider=new AutomaticGeminiEntryProvider('synthetic-not-a-live-key',{list:async()=>['gemini-3.6-flash','gemini-3.8-flash'].map(name=>({name,supportedActions:['generateContent'],outputTokenLimit:2048})),build:model=>({provider:'gemini',extract:async()=>{throw new Error('Not an entry request');},guide:async()=>{chosen.push(model);if(chosen.length===1)throw new Error('AI_PROVIDER_BUSY');return {provider:'gemini',sourceSha256:guideInputHash(input),guide:answer};}})});
  await assert.rejects(provider.guide(input),/AI_PROVIDER_BUSY/);assert.deepEqual(chosen,['gemini-3.6-flash']);
  await provider.guide(input);assert.deepEqual(chosen,['gemini-3.6-flash','gemini-3.8-flash']);
});

test('guide HTTP path enforces owner, consent, origin, quota and request replay before generation',async t=>{
  const app=express();let calls=0;
  app.use('/api/ai',createAIRouter({enabled:true,allowedOrigins:new Set(['https://example.invalid']),verifyToken:async()=>owner,budget:new DevelopmentAIBudget({perMinute:1,perDay:1,globalPerDay:1}),provider:{provider:'gemini',extract:async()=>{throw new Error('Wrong path');},guide:async value=>{calls++;return {provider:'gemini',sourceSha256:guideInputHash(value),guide:answer};}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/ai/guide`,requestId=randomUUID();
  const post=(body:unknown,origin='https://example.invalid',authorization='Bearer synthetic')=>fetch(url,{method:'POST',headers:{Origin:origin,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({ownerHash:owner,requestId,input},'https://evil.invalid')).status,403);
  assert.equal((await post({ownerHash:owner,requestId,input},undefined,'')).status,401);
  assert.equal((await post({ownerHash:'b'.repeat(64),requestId,input})).status,403);
  assert.equal((await post({ownerHash:owner,requestId,input:{...input,consent:false}})).status,400);
  assert.equal(calls,0);
  const success=await post({ownerHash:owner,requestId,input});assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'no-store, private');assert.deepEqual((await success.json()).guide,answer);
  assert.equal((await post({ownerHash:owner,requestId,input})).status,409);
  assert.equal((await post({ownerHash:owner,requestId:randomUUID(),input})).status,429);assert.equal(calls,1);
});

test('guide client binds response to owner, request and exact summary without sending credentials in URLs',async()=>{
  let active=owner;
  const identity={isTestMode:()=>false,getValidAccessToken:async()=>'synthetic-token',getProfile:()=>({subjectHash:active})};
  const fetchFn:typeof fetch=async(url,options)=>{
    assert.equal(String(url),'https://example.invalid/api/ai/guide');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');
    const body=JSON.parse(options?.body as string);
    return Response.json({requestId:body.requestId,sourceSha256:guideInputHash(body.input),provider:'gemini',guide:answer});
  };
  assert.deepEqual(await requestFinancialGuide(input,owner,identity,{endpoint:'https://example.invalid/api/ai/guide',signal:new AbortController().signal,fetchFn}),answer);
  await assert.rejects(requestFinancialGuide(input,owner,identity,{endpoint:'https://example.invalid/api/ai/guide',signal:new AbortController().signal,fetchFn:async()=>{active='b'.repeat(64);return Response.json(answer);}}),/AI_OWNER_MISMATCH/);
});
