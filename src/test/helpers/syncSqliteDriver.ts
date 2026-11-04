import { DatabaseSync } from 'node:sqlite';
import type { DurableStorageDriver } from '../../storage/drivers/durableStorage';

/** Real SQLite engine/files in tests only; not a claim about the Capacitor Android bridge. */
export class SyncTestSqliteDriver implements DurableStorageDriver {
  private db:DatabaseSync;
  failCommit=false;
  constructor(readonly path:string){this.db=new DatabaseSync(path);this.db.exec('create table if not exists kv(key text primary key,value text not null)');}
  async init(){}
  async getItem(key:string){return (this.db.prepare('select value from kv where key=?').get(key) as {value:string}|undefined)?.value??null;}
  async setItem(key:string,value:string){this.db.prepare('insert into kv(key,value) values(?,?) on conflict(key) do update set value=excluded.value').run(key,value);}
  async removeItem(key:string){this.db.prepare('delete from kv where key=?').run(key);}
  async beginTransaction(){this.db.exec('begin');}
  async commitTransaction(){if(this.failCommit){this.failCommit=false;throw Error('SYNTHETIC_COMMIT_FAILURE');}this.db.exec('commit');}
  async rollbackTransaction(){this.db.exec('rollback');}
  async isPersistent(){return true;}
  getType(){return 'sqlite-native' as const;}
  close(){this.db.close();}
}
