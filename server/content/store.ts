import { createHash } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { validateContentDraft,validateContentDocument,type ContentDocument,type ContentDraft } from '../../src/content/contracts.js';

export class ContentError extends Error { constructor(public code:string,public status=503){super(code);} }
export interface ContentStore {
  listPublished():Promise<ContentDocument[]>;
  listDrafts():Promise<ContentDocument[]>;
  save(actor:string,requestId:string,id:string,draft:ContentDraft,expectedRevision:number):Promise<ContentDocument>;
}
function document(row:any):ContentDocument {
  return validateContentDocument({...validateContentDraft(row.data),id:row.id,revision:row.revision,updatedAt:new Date(row.updated_at).toISOString()});
}
/** Durable PostgreSQL only; no runtime CREATE TABLE, in-memory fallback or Redis ledger. */
export class PostgresContentStore implements ContentStore {
  constructor(private pool:Pick<Pool,'query'|'connect'>){}
  async listPublished(){const result=await this.pool.query("SELECT id,revision,data,updated_at FROM hisab_content_documents WHERE kind='article' AND data->>'status'='published' ORDER BY updated_at DESC,id LIMIT 100");return result.rows.map(document);}
  async listDrafts(){const result=await this.pool.query('SELECT id,revision,data,updated_at FROM hisab_content_documents ORDER BY updated_at DESC,id LIMIT 100');return result.rows.map(document);}
  async save(actor:string,requestId:string,id:string,draft:ContentDraft,expectedRevision:number){
    const normalized=validateContentDraft(draft);
    const requestHash=createHash('sha256').update(JSON.stringify({id,draft:normalized,expectedRevision})).digest('hex');
    const client:PoolClient=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[requestId]);
      const repeated=await client.query('SELECT actor_hash,request_hash,response FROM hisab_content_commands WHERE request_id=$1',[requestId]);
      if(repeated.rows.length){const row=repeated.rows[0];if(row.actor_hash!==actor||row.request_hash!==requestHash)throw new ContentError('CONTENT_CONFLICT',409);const value=validateContentDocument(row.response);await client.query('COMMIT');return value;}
      const result=expectedRevision===0
        ?await client.query('INSERT INTO hisab_content_documents(id,kind,revision,data) VALUES($1,$2,1,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id,revision,data,updated_at',[id,normalized.kind,JSON.stringify(normalized)])
        :await client.query('UPDATE hisab_content_documents SET revision=revision+1,data=$1::jsonb,updated_at=now() WHERE id=$2 AND revision=$3 AND kind=$4 RETURNING id,revision,data,updated_at',[JSON.stringify(normalized),id,expectedRevision,normalized.kind]);
      if(result.rows.length!==1)throw new ContentError('CONTENT_CONFLICT',409);
      const saved=document(result.rows[0]);
      await client.query('INSERT INTO hisab_content_commands(request_id,actor_hash,request_hash,document_id,response) VALUES($1,$2,$3,$4,$5::jsonb)',[requestId,actor,requestHash,id,JSON.stringify(saved)]);
      await client.query('COMMIT');return saved;
    } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
}
