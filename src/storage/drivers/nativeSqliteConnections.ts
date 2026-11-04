interface ConnectionManager {
  checkConnectionsConsistency(): Promise<unknown>;
  isConnection(name: string, readonly: boolean): Promise<{ result?: boolean }>;
  retrieveConnection(name: string, readonly: boolean): Promise<any>;
  createConnection(name: string, encrypted: boolean, mode: string, version: number, readonly: boolean): Promise<any>;
}

/** One SDK connection dictionary per WebView. A fresh dictionary's consistency
 * check closes ALL native connections, including other stores' live databases. */
export class NativeSqliteConnections {
  private manager?: Promise<ConnectionManager>;
  private queue: Promise<unknown> = Promise.resolve();
  private openings = new Map<string, Promise<any>>();

  constructor(private createManager: () => Promise<ConnectionManager>) {}

  open(name: string): Promise<any> {
    const existing = this.openings.get(name);
    if (existing) return existing;
    const opening = this.queue.then(async () => {
      this.manager ??= this.createManager().then(async manager => {
        await manager.checkConnectionsConsistency();
        return manager;
      }).catch(error => { this.manager = undefined; throw error; });
      const manager = await this.manager;
      const connected = await manager.isConnection(name, false);
      const database = connected.result ? await manager.retrieveConnection(name, false)
        : await manager.createConnection(name, false, 'no-encryption', 1, false);
      await database.open();
      return database;
    }).catch(error => { this.openings.delete(name); throw error; });
    this.openings.set(name, opening);
    this.queue = opening.catch(() => {});
    return opening;
  }
}

export const nativeSqliteConnections = new NativeSqliteConnections(async () => {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  return new SQLiteConnection(CapacitorSQLite);
});
