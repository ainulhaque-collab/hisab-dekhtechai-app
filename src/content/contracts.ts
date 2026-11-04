export type ContentKind='article'|'announcement';
export interface ContentDraft {kind:ContentKind;language:'en'|'bn';title:string;body:string;status:'draft'|'published';audience:'public'|'self'|'opted-in';sources:string[]}
export interface ContentDocument extends ContentDraft {id:string;revision:number;updatedAt:string}
export const contentId=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export function validateContentDraft(raw:any):ContentDraft {
  const names=['kind','language','title','body','status','audience','sources'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==names.length||!names.every(name=>Object.hasOwn(raw,name))||!['article','announcement'].includes(raw.kind)||!['bn','en'].includes(raw.language)||!['draft','published'].includes(raw.status)||!['public','self','opted-in'].includes(raw.audience)) throw new Error('CONTENT_REQUEST_INVALID');
  if(raw.kind==='article'?raw.audience!=='public':raw.status!=='draft'||raw.audience==='public') throw new Error('CONTENT_REQUEST_INVALID');
  for(const [key,max] of [['title',120],['body',6000]] as const) if(typeof raw[key]!=='string'||!raw[key].trim()||raw[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw[key])) throw new Error('CONTENT_REQUEST_INVALID');
  if(!Array.isArray(raw.sources)||raw.sources.length>3) throw new Error('CONTENT_REQUEST_INVALID');
  for(const link of raw.sources){if(typeof link!=='string'||link.length>500)throw new Error('CONTENT_REQUEST_INVALID');let url:URL;try{url=new URL(link);}catch{throw new Error('CONTENT_REQUEST_INVALID');}if(url.protocol!=='https:'||url.username||url.password)throw new Error('CONTENT_REQUEST_INVALID');}
  return {kind:raw.kind,language:raw.language,title:raw.title.trim(),body:raw.body.trim(),status:raw.status,audience:raw.audience,sources:[...raw.sources]};
}
export function validateContentDocument(raw:any):ContentDocument {
  if(!raw||!contentId(raw.id)||!Number.isSafeInteger(raw.revision)||raw.revision<1||raw.revision>1_000_000||typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))) throw new Error('CONTENT_RESPONSE_INVALID');
  const {id,revision,updatedAt,...draft}=raw;
  return {...validateContentDraft(draft),id,revision,updatedAt};
}
