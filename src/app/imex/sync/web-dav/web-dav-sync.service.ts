import { Injectable } from '@angular/core';
import {
  SyncProvider,
  SyncProviderServiceInterface,
  SyncTarget,
} from '../sync-provider.model';
import { SyncGetRevResult } from '../sync.model';

import { Observable } from 'rxjs';
import { concatMap, distinctUntilChanged, first, map } from 'rxjs/operators';
import { WebDavApiService } from './web-dav-api.service';
import { DataInitService } from '../../../core/data-init/data-init.service';
import { WebDavConfig } from '../../../features/config/global-config.model';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { GlobalProgressBarService } from '../../../core-ui/global-progress-bar/global-progress-bar.service';
import { T } from '../../../t.const';
import { WebDavHeadResponse } from './web-dav.model';

@Injectable({ providedIn: 'root' })
export class WebDavSyncService implements SyncProviderServiceInterface {
  id: SyncProvider = SyncProvider.WebDAV;

  isReady$: Observable<boolean> = this._dataInitService.isAllDataLoadedInitially$.pipe(
    concatMap(() => this._webDavApiService.isAllConfigDataAvailable$),
    distinctUntilChanged(),
  );

  private _cfg$: Observable<WebDavConfig> = this._globalConfigService.cfg$.pipe(
    map((cfg) => cfg?.sync.webDav),
  );

  //
  constructor(
    private _webDavApiService: WebDavApiService,
    private _dataInitService: DataInitService,
    private _globalConfigService: GlobalConfigService,
    private _globalProgressBarService: GlobalProgressBarService,
  ) {}

  async getFileRevAndLastClientUpdate(
    syncTarget: SyncTarget,
    localRev: string,
  ): Promise<{ rev: string; clientUpdate: number } | SyncGetRevResult> {
    const cfg = await this._cfg$.pipe(first()).toPromise();

    try {
      const meta = await this._webDavApiService.getMetaData(
        this._getFilePath(syncTarget, cfg),
      );
      // @ts-ignore
      const d = new Date(meta['last-modified']);
      return {
        clientUpdate: d.getTime(),
        rev: this._getRevFromMeta(meta),
      };
    } catch (e: any) {
      const isAxiosError = !!(e?.response && e.response.status);

      if ((isAxiosError && e.response.status === 404) || e.status === 404) {
        return 'NO_REMOTE_DATA';
      }

      console.error(e);
      return e as Error;
    }
  }

  async downloadFileData(
    syncTarget: SyncTarget,
    localRev: string,
  ): Promise<{ rev: string; dataStr: string }> {
    this._globalProgressBarService.countUp(T.GPB.WEB_DAV_DOWNLOAD);
    const cfg = await this._cfg$.pipe(first()).toPromise();
    try {
      const filePath = this._getFilePath(syncTarget, cfg);
      const r = await this._webDavApiService.download({
        path: filePath,
        localRev,
      });
      const meta = await this._webDavApiService.getMetaData(filePath);
      this._globalProgressBarService.countDown();
      return {
        rev: this._getRevFromMeta(meta),
        dataStr: r,
      };
    } catch (e) {
      this._globalProgressBarService.countDown();
      // TODO fix error handling
      return e as any;
    }
  }

  async uploadFileData(
    syncTarget: SyncTarget,
    dataStr: string,
    clientModified: number,
    localRev: string,
    isForceOverwrite: boolean = false,
  ): Promise<string | Error> {
    this._globalProgressBarService.countUp(T.GPB.WEB_DAV_UPLOAD);
    const cfg = await this._cfg$.pipe(first()).toPromise();
    try {
      const filePath = this._getFilePath(syncTarget, cfg);
      await this._webDavApiService.upload({
        path: filePath,
        data: dataStr,
      });

      const meta = await this._webDavApiService.getMetaData(filePath);
      this._globalProgressBarService.countDown();
      return this._getRevFromMeta(meta);
    } catch (e) {
      console.error(e);
      this._globalProgressBarService.countDown();
      return e as Error;
    }
  }

  private _getRevFromMeta(meta: WebDavHeadResponse): string {
    if (typeof meta?.etag !== 'string') {
      console.warn('No etag for WebDAV');
    }
    const rev = meta.etag || meta['oc-etag'] || meta['last-modified'];
    if (!rev) {
      throw new Error('Not able to get rev for WebDAV');
    }
    return rev;
  }

  private _getFilePath(syncTarget: SyncTarget, cfg: WebDavConfig): string {
    return `${cfg.syncFolderPath as string}/${syncTarget}.json`;
  }
}
