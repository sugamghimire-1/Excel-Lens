/** Workbook storage. The default provider keeps everything in this browser. */
import { deserializeWorkbook, serializeWorkbook, type JsonWorkbook } from '@/engine/serialize';
import type { Workbook } from '@/types';

export interface WorkbookMeta {
  id: string;
  name: string;
  updated: number;
  sheetCount: number;
  cellCount: number;
}

/**
 * Where workbooks live. Implement this interface against an HTTP API to add
 * cloud storage; nothing else in the app needs to change.
 */
export interface StorageProvider {
  list(): Promise<WorkbookMeta[]>;
  load(id: string): Promise<Workbook | null>;
  save(workbook: Workbook): Promise<WorkbookMeta>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'tessera';
const DB_VERSION = 1;
const META = 'meta';
const DATA = 'data';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Storage request failed.'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was aborted.'));
  });
}

export class IndexedDbProvider implements StorageProvider {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(META, { keyPath: 'id' });
          req.result.createObjectStore(DATA, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Could not open browser storage.'));
      });
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  async list(): Promise<WorkbookMeta[]> {
    const db = await this.open();
    const all = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<WorkbookMeta[]>);
    return all.sort((a, b) => b.updated - a.updated);
  }

  async load(id: string): Promise<Workbook | null> {
    const db = await this.open();
    const data = await request(db.transaction(DATA).objectStore(DATA).get(id) as IDBRequest<JsonWorkbook | undefined>);
    return data ? deserializeWorkbook(data) : null;
  }

  async save(workbook: Workbook): Promise<WorkbookMeta> {
    const db = await this.open();
    const meta: WorkbookMeta = {
      id: workbook.id,
      name: workbook.name,
      updated: Date.now(),
      sheetCount: workbook.sheets.length,
      cellCount: workbook.sheets.reduce((n, s) => n + s.cells.size, 0),
    };
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(DATA).put(serializeWorkbook(workbook));
    tx.objectStore(META).put(meta);
    await done(tx);
    return meta;
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(DATA).delete(id);
    tx.objectStore(META).delete(id);
    await done(tx);
  }
}

export const storage: StorageProvider = new IndexedDbProvider();

/* ------------------------------------------------------------- preferences */

/** Small synchronous settings. Failures (private mode, quota) are ignored. */
export const prefs = {
  get(key: string, fallback: string): string {
    try {
      return localStorage.getItem(`tessera.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`tessera.${key}`, value);
    } catch {
      // Preferences are a convenience; the app works without them.
    }
  },
};
