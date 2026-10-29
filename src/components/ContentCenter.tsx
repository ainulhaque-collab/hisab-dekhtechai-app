import { useEffect,useRef,useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useApp } from '../context/AppContext';
import { aiEndpoint } from '../ai/client';
import { contentRequest,publicArticles,contentError } from '../content/client';
import { validateContentDraft,type ContentDraft,type ContentDocument,type ContentKind } from '../content/contracts';
import { AppSelect } from './AppSelect';
import { primaryButton,secondaryButton } from './ModalShell';

const blank=(kind:ContentKind,language:'en'|'bn'):ContentDraft=>({kind,language,title:'',body:'',status:'draft',audience:kind==='article'?'public':'self',sources:[]});
export function ContentCenter(){
  const {db,auth,language,isOnline}=useApp(),en=language==='en',owner=db.getIdentity()?.ownerSubjectHash||'';
  const [articles,setArticles]=useState<ContentDocument[]>([]),[documents,setDocuments]=useState<ContentDocument[]>([]);
  const [role,setRole]=useState<{isAdmin:boolean;configured:boolean}|null>(null),[error,setError]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[editing,setEditing]=useState<{id:string;revision:number;draft:ContentDraft}|null>(null),[saved,setSaved]=useState(false);
  const active=useRef(true),lock=useRef(false),command=useRef<{hash:string;id:string}|null>(null),abort=useRef<AbortController|null>(null);
  const ownerNow=useRef(owner);ownerNow.current=owner;
  let origin='';try{origin=new URL(aiEndpoint(import.meta.env.VITE_AI_API_BASE_URL||'',location.origin,Capacitor.isNativePlatform())).origin;}catch{}
  useEffect(()=>{
    const controller=new AbortController();abort.current=controller;active.current=true;setLoading(true);setError('');setRole(null);setArticles([]);setDocuments([]);setEditing(null);
    void(async()=>{
      try{if(!origin)throw new Error('CONTENT_NOT_CONFIGURED');const posts=await publicArticles(origin,controller.signal);if(!controller.signal.aborted)setArticles(posts);}catch(error){if(!controller.signal.aborted)setError(contentError(error,en));}finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>{controller.abort();active.current=false;};
  },[origin,owner,en]);
  const edit=(entry:ContentDocument)=>{const {id,revision,updatedAt,...draft}=entry;setEditing({id,revision,draft});setSaved(false);command.current=null;};
  const update=(patch:Partial<ContentDraft>)=>{setEditing(current=>current?{...current,draft:{...current.draft,...patch}}:null);setSaved(false);};
  const loadAdmin=async()=>{
    if(lock.current||!origin||!owner)return;lock.current=true;setBusy(true);setError('');
    const target=owner;
    try{const status=await contentRequest(origin,'status',owner,auth,{},abort.current?.signal);if(!active.current||ownerNow.current!==target)return;setRole(status);
      if(status.isAdmin&&status.configured){const result=await contentRequest(origin,'list',owner,auth,{},abort.current?.signal);if(active.current&&ownerNow.current===target){setDocuments(result.documents);setEditing(null);}}
    }catch(error){if(active.current&&ownerNow.current===target)setError(contentError(error,en));}finally{lock.current=false;if(active.current)setBusy(false);}
  };
  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-slate-600">{en?'Read educational posts published by the approved Admin. Readers cannot publish or send announcements.':'অনুমোদিত Admin-এর প্রকাশিত শিক্ষামূলক লেখা পড়ুন। সাধারণ ব্যবহারকারী প্রকাশ বা ঘোষণা পাঠাতে পারবেন না।'}</p>
    {loading&&<p role="status" className="text-xs text-slate-500">{en?'Loading…':'লোড হচ্ছে…'}</p>}
    {!loading&&!error&&!articles.length&&<p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">{en?'No published posts yet.':'এখনও প্রকাশিত লেখা নেই।'}</p>}
    {articles.map(article=><article key={article.id} className="space-y-3 rounded-2xl border border-slate-100 p-4"><h3 className="break-words text-sm font-semibold">{article.title}</h3><p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{article.body}</p>{article.sources.map(link=><a key={link} href={link} target="_blank" rel="noreferrer noopener" className="block break-all text-xs text-blue-700">{link}</a>)}</article>)}
    <button type="button" disabled={!owner||!isOnline||busy} className={`${secondaryButton} w-full`} onClick={()=>void loadAdmin()}>{busy?(en?'Checking…':'যাচাই হচ্ছে…'):(en?'Check Admin access / reload drafts':'Admin অনুমতি যাচাই / খসড়া লোড')}</button>
    {!owner&&<p className="text-xs text-slate-500">{en?'Connect Google to check Admin access. Published posts do not require Admin access.':'Admin অনুমতি যাচাই করতে Google সংযুক্ত করুন। প্রকাশিত লেখা পড়তে Admin হতে হয় না।'}</p>}
    {role&&!role.isAdmin&&<p className="text-xs text-slate-500">{en?'Reader access. Publishing is reserved for the approved Admin.':'পাঠক হিসেবে ব্যবহার করছেন। প্রকাশের অনুমতি শুধু অনুমোদিত Admin-এর।'}</p>}
    {role?.isAdmin&&!role.configured&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{en?'Admin identity verified. PostgreSQL setup is required before saving drafts or publishing.':'Admin পরিচয় যাচাই হয়েছে। খসড়া সংরক্ষণ বা প্রকাশের আগে PostgreSQL সেটআপ প্রয়োজন।'}</p>}
    {role?.isAdmin&&role.configured&&<section className="space-y-3 border-t border-slate-100 pt-4"><h3 className="text-sm font-semibold">{en?'Admin workspace':'Admin-এর কাজের জায়গা'}</h3><div className="grid grid-cols-2 gap-2">{(['article','announcement'] as ContentKind[]).map(kind=><button type="button" key={kind} disabled={busy} className={secondaryButton} onClick={()=>{setEditing({id:crypto.randomUUID(),revision:0,draft:blank(kind,language)});setSaved(false);command.current=null;}}>{kind==='article'?(en?'New post':'নতুন লেখা'):(en?'Announcement draft':'ঘোষণার খসড়া')}</button>)}</div>
      <p className="text-xs text-slate-500">{en?'Up to the latest 100 documents. Announcement sending is disabled; choosing recipients only saves the draft plan.':'সর্বশেষ সর্বোচ্চ ১০০টি লেখা। ঘোষণা পাঠানো বন্ধ আছে; প্রাপক বাছাই করলে শুধু খসড়ার পরিকল্পনা সংরক্ষিত হবে।'}</p>
      {documents.map(entry=><button type="button" key={entry.id} disabled={busy} className={`${secondaryButton} w-full justify-between text-left`} onClick={()=>edit(entry)}><span className="truncate">{entry.title}</span><span>{entry.status}</span></button>)}
      {editing&&<form className="space-y-3" onSubmit={async event=>{
        event.preventDefault();if(lock.current)return;setError('');setSaved(false);let draft:ContentDraft;
        try{draft=validateContentDraft(editing.draft);}catch{setError(en?'Check the title, text and source links.':'শিরোনাম, লেখা ও সোর্স লিংক যাচাই করুন।');return;}
        lock.current=true;setBusy(true);const target=owner,key=JSON.stringify({id:editing.id,revision:editing.revision,draft});if(command.current?.hash!==key)command.current={hash:key,id:crypto.randomUUID()};
        try{const result=await contentRequest(origin,'save',owner,auth,{requestId:command.current.id,id:editing.id,expectedRevision:editing.revision,document:draft},abort.current?.signal);if(active.current&&ownerNow.current===target){edit(result.document);setDocuments(items=>[result.document,...items.filter(item=>item.id!==result.document.id)].slice(0,100));setSaved(true);if(result.document.kind==='article')setArticles(items=>[...items.filter(item=>item.id!==result.document.id),...(result.document.status==='published'?[result.document]:[])]);}}
        catch(error){if(active.current&&ownerNow.current===target)setError(contentError(error,en));}finally{lock.current=false;if(active.current)setBusy(false);}
      }}>
        <label className="block text-xs font-semibold">{en?'Title':'শিরোনাম'}<input required maxLength={120} value={editing.draft.title} disabled={busy} onChange={event=>update({title:event.target.value})} className="mt-2 w-full rounded-xl border border-slate-200 p-3"/></label>
        <label className="block text-xs font-semibold">{en?'Text':'লেখা'}<textarea required maxLength={6000} rows={8} value={editing.draft.body} disabled={busy} onChange={event=>update({body:event.target.value})} className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal leading-relaxed"/></label>
        <label className="block text-xs font-semibold">{en?'Public source links, one per line (up to 3)':'প্রকাশ্য সোর্স লিংক, প্রতি লাইনে একটি (সর্বোচ্চ ৩টি)'}<textarea rows={3} value={editing.draft.sources.join('\n')} disabled={busy} onChange={event=>update({sources:event.target.value.split('\n').filter(Boolean)})} className="mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal"/></label>
        {editing.draft.kind==='article'?<label className="flex min-h-11 items-center gap-3 text-xs"><input type="checkbox" disabled={busy} checked={editing.draft.status==='published'} onChange={event=>update({status:event.target.checked?'published':'draft'})}/>{en?'Publish publicly for all readers':'সব পাঠকের জন্য প্রকাশ করুন'}</label>:<label className="block text-xs font-semibold">{en?'Planned audience':'পরিকল্পিত প্রাপক'}<AppSelect value={editing.draft.audience} disabled={busy} onChange={event=>update({audience:event.target.value as 'self'|'opted-in'})} className="mt-2 w-full rounded-xl border border-slate-200 p-3"><option value="self">{en?'My test devices only':'শুধু নিজের পরীক্ষার ডিভাইস'}</option><option value="opted-in">{en?'Opted-in users (sending not enabled)':'অনুমতি দেওয়া ব্যবহারকারী (পাঠানো চালু নয়)'}</option></AppSelect></label>}
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>{busy?(en?'Saving…':'সংরক্ষণ হচ্ছে…'):editing.draft.status==='published'?(en?'Publish post':'লেখা প্রকাশ করুন'):(en?'Save draft':'খসড়া সংরক্ষণ করুন')}</button>
        {saved&&<p role="status" className="text-xs text-emerald-700">{en?'Saved to the content database. No notification was sent.':'কনটেন্ট ডেটাবেসে সংরক্ষিত হয়েছে। কোনো নোটিফিকেশন পাঠানো হয়নি।'}</p>}
      </form>}
    </section>}
    {error&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">{error}</p>}
  </div>;
}
