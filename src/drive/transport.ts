/**
 * Google Drive appDataFolder Transport
 * Supports real Google Drive v3 REST API and multi-device cloud simulation for automated tests.
 */

import { SyncBatch, SyncOperation, UUID } from '../contracts/types';
import { canonicalJson, computeSha256 } from '../sync/canonical';

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  appProperties?: Record<string, string>;
}

export interface DriveTransport {
  listAppDataFiles(): Promise<DriveFileMetadata[]>;
  uploadBatchFile(name: string, contentJson: string): Promise<{ fileId: string; name: string }>;
  downloadBatchFile(fileId: string): Promise<string>;
  deleteFile(fileId: string): Promise<void>;
  getQuotaStatus(): Promise<{ usedBytes: number; totalBytes: number; isFull: boolean }>;
}

/**
 * Real Google Drive REST API Client for appDataFolder
 */
export class RealGoogleDriveTransport implements DriveTransport {
  private accessToken: string;
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  public setAccessToken(token: string): void {
    this.accessToken = token;
  }

  public async listAppDataFiles(): Promise<DriveFileMetadata[]> {
    const allFiles: DriveFileMetadata[] = [];
    let pageToken: string | null = null;

    do {
      let url = `${this.baseUrl}/files?spaces=appDataFolder&fields=nextPageToken,files(id,name,mimeType,size,createdTime)&pageSize=100`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const res = await this.fetchWithRetry(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!res.ok) {
        this.handleHttpError(res.status, await res.text());
      }

      const data = await res.json();
      if (data.files && Array.isArray(data.files)) {
        allFiles.push(...data.files);
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    return allFiles;
  }

  public async uploadBatchFile(
    name: string,
    contentJson: string
  ): Promise<{ fileId: string; name: string }> {
    const metadata = {
      name,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      contentJson +
      closeDelimiter;

    const res = await this.fetchWithRetry(this.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (!res.ok) {
      this.handleHttpError(res.status, await res.text());
    }

    const json = await res.json();
    return { fileId: json.id, name: json.name };
  }

  public async downloadBatchFile(fileId: string): Promise<string> {
    const url = `${this.baseUrl}/files/${fileId}?alt=media`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      this.handleHttpError(res.status, await res.text());
    }

    return await res.text();
  }

  private async fetchWithRetry(
    input: RequestInfo | URL,
    init?: RequestInit,
    maxRetries = 3
  ): Promise<Response> {
    let attempt = 0;
    let delay = 500;

    while (true) {
      try {
        const res = await fetch(input, init);
        if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
          attempt++;
          if (attempt >= maxRetries) return res;
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        return res;
      } catch (networkErr) {
        attempt++;
        if (attempt >= maxRetries) throw networkErr;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }

  public async deleteFile(fileId: string): Promise<void> {
    const url = `${this.baseUrl}/files/${fileId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (!res.ok && res.status !== 404) {
      this.handleHttpError(res.status, await res.text());
    }
  }

  public async getQuotaStatus(): Promise<{ usedBytes: number; totalBytes: number; isFull: boolean }> {
    const url = `${this.baseUrl}/about?fields=storageQuota`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      return { usedBytes: 0, totalBytes: 15 * 1024 * 1024 * 1024, isFull: false };
    }

    const data = await res.json();
    const quota = data.storageQuota;
    const used = Number(quota?.usage || 0);
    const limit = Number(quota?.limit || 15 * 1024 * 1024 * 1024);
    return {
      usedBytes: used,
      totalBytes: limit,
      isFull: limit > 0 && used >= limit,
    };
  }

  private handleHttpError(status: number, message: string): never {
    if (status === 401) {
      throw new Error(`Google Drive 401 Unauthorized: token expired or invalid.`);
    }
    if (status === 403) {
      if (message.includes('quota') || message.includes('storageQuotaExceeded')) {
        throw new Error(`Google Drive 403 Storage Quota Exceeded: User Google Drive is full.`);
      }
      throw new Error(`Google Drive 403 Forbidden: insufficient appDataFolder permissions.`);
    }
    if (status === 429) {
      throw new Error(`Google Drive 429 Rate Limited: too many sync requests, backing off.`);
    }
    if (status >= 500) {
      throw new Error(`Google Drive ${status} Server Error: remote service temporarily unavailable.`);
    }
    throw new Error(`Google Drive API error (${status}): ${message}`);
  }
}

/**
 * Shared Cloud Storage Simulation
 * Allows 2 or more devices (e.g. Device A and Device B) to test realistic concurrent Drive sync,
 * offline mutation, reconciliation, and fault injection (401, 403 quota, 429, 500).
 */
export class SimulatedGoogleDriveTransport implements DriveTransport {
  // Shared static memory across simulated device instances
  private static sharedAppDataFolder: Map<string, { meta: DriveFileMetadata; content: string }> =
    new Map();

  public simulateFault: 'none' | '401_expired' | '403_quota' | '429_rate_limit' | '500_server_error' =
    'none';

  public static clearSharedCloud(): void {
    SimulatedGoogleDriveTransport.sharedAppDataFolder.clear();
  }

  public async listAppDataFiles(): Promise<DriveFileMetadata[]> {
    this.checkSimulatedFault();
    return Array.from(SimulatedGoogleDriveTransport.sharedAppDataFolder.values()).map((v) => v.meta);
  }

  public async uploadBatchFile(
    name: string,
    contentJson: string
  ): Promise<{ fileId: string; name: string }> {
    this.checkSimulatedFault();
    const fileId = 'gdrive-file-' + Math.random().toString(36).substring(2, 10);
    const meta: DriveFileMetadata = {
      id: fileId,
      name,
      mimeType: 'application/json',
      size: contentJson.length,
      createdTime: new Date().toISOString(),
    };
    SimulatedGoogleDriveTransport.sharedAppDataFolder.set(fileId, { meta, content: contentJson });
    return { fileId, name };
  }

  public async downloadBatchFile(fileId: string): Promise<string> {
    this.checkSimulatedFault();
    const entry = SimulatedGoogleDriveTransport.sharedAppDataFolder.get(fileId);
    if (!entry) {
      throw new Error(`Google Drive file ${fileId} not found (404)`);
    }
    return entry.content;
  }

  public async deleteFile(fileId: string): Promise<void> {
    this.checkSimulatedFault();
    SimulatedGoogleDriveTransport.sharedAppDataFolder.delete(fileId);
  }

  public async getQuotaStatus(): Promise<{ usedBytes: number; totalBytes: number; isFull: boolean }> {
    if (this.simulateFault === '403_quota') {
      return { usedBytes: 15000000000, totalBytes: 15000000000, isFull: true };
    }
    let totalSize = 0;
    for (const item of SimulatedGoogleDriveTransport.sharedAppDataFolder.values()) {
      totalSize += item.content.length;
    }
    return {
      usedBytes: totalSize,
      totalBytes: 15 * 1024 * 1024 * 1024,
      isFull: false,
    };
  }

  private checkSimulatedFault(): void {
    if (this.simulateFault === '401_expired') {
      throw new Error('Google Drive 401 Unauthorized: token expired or invalid.');
    }
    if (this.simulateFault === '403_quota') {
      throw new Error('Google Drive 403 Storage Quota Exceeded: User Google Drive is full.');
    }
    if (this.simulateFault === '429_rate_limit') {
      throw new Error('Google Drive 429 Rate Limited: too many sync requests, backing off.');
    }
    if (this.simulateFault === '500_server_error') {
      throw new Error('Google Drive 500 Server Error: remote service temporarily unavailable.');
    }
  }
}
