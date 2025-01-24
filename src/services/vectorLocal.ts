import path, { extname } from 'path';
import vscode, { EventEmitter } from 'vscode';
import { Ignore } from 'ignore';
import fs from 'fs';
import { logger } from '@/utils/logger';
import { getCurrentPluginVersion, getWorkspaceRoot } from '@/utils/vscode-extend';
import { md5 } from '@/utils/md5';
import { saveLocalRagMetadata, IMetadataInfo, readLocalRagMetadata } from './storage';
import { buildFileMeta, getIgnore, IFileMata, IGNORED_FOLDERS, MAX_FOLDER_COUNT } from './vector';
import {
  buildLocalRagContent,
  deleteLocalRagContent,
  getLocalRagHomeDir,
  IChangedRecord,
  LOCAL_RAG_STORE_DIR,
  startRagService,
} from './rag';
import { getGitRemoteUrl } from '@/utils/git';
import { randomUUID } from 'crypto';
import { sanitizeFilePath } from '@/utils';
import l10n from '@/l10n';
import { FE_FILE_EXTS } from '@/utils/consts';

const BATCH_FILES_COUNT = 10;

let onBuildIndexProgress: EventEmitter<string> | null = null;
interface ICommonParam {
  gitRepo?: string;
  projectName: string;
  projectLocation: string;
  homeDir: string;
}

function buildLocalRag(commonParam: ICommonParam, records?: IChangedRecord[][]) {
  // console.log('======================buildLocalRag', records?.length);
  return buildLocalRagContent({
    batchId: randomUUID(),
    ...commonParam,
    submitEnd: !records?.length,
    changedRecords: records?.reduce((pre, next) => {
      const chunk = next[0];
      pre[chunk.filePath] = next;
      return pre;
    }, {} as Record<string, IChangedRecord[]>),
  }).catch((err) => logger.error(err));
}

function buildSubmitRecord(fileMeta: IFileMata): IChangedRecord[] {
  const functions = fileMeta.functions.concat(fileMeta.classes.map((item) => item.methods || []).flat());
  return functions.map((fn) => {
    return {
      recordId: randomUUID(),
      filePath: fileMeta.filePath,
      fileHash: fileMeta.hash,
      chunkHash: md5((fn.comment || '') + fn.code),
      startOffset: fn.startIndex,
      endOffset: fn.endIndex,
      startLine: fn.startPosition.row,
      endLine: fn.endPosition.row,
      startColumn: fn.startPosition.column,
      endColumn: fn.endPosition.column,
      comments: fn.comment,
      code: fn.code,
    };
  });
}

/**
 * @param ig git ignore.
 * @param root parent folder of project path.
 * @param pDir the folder to read.
 * @param projRoot the root folder of the project.
 * @returns
 */
async function buildProjectIndexInfo(
  ig: Ignore,
  root: string,
  pDir: string,
  projRoot: string,
  param: ICommonParam,
  newFileMetas: IMetadataInfo,
  cache: IChangedRecord[][]
) {
  const dirPath = path.join(root, pDir);
  const dirs = fs.readdirSync(dirPath);

  if (dirs.length > MAX_FOLDER_COUNT) {
    //ignore large folder
    return;
  }

  for (const dir of dirs) {
    const filePath = path.join(dirPath, dir);
    if (/^\./.test(dir)) {
      // ignore folder or file that start with "." by default;
      continue;
    }

    const relativePath = path.relative(projRoot, filePath);
    if (ig.ignores(relativePath)) {
      continue;
    }

    if (fs.statSync(filePath).isDirectory()) {
      if (!IGNORED_FOLDERS.includes(dir)) {
        const pdDirNext = path.join(pDir, dir);
        await buildProjectIndexInfo(ig, root, pdDirNext, projRoot, param, newFileMetas, cache);
      }
    } else if (FE_FILE_EXTS.includes(extname(dir))) {
      onBuildIndexProgress?.fire(l10n.t('generating') + relativePath);
      const fileMeta = await buildFileMeta(filePath);
      if (fileMeta) {
        fileMeta.filePath = relativePath;
        if (cache.length >= BATCH_FILES_COUNT) {
          await buildLocalRag(param, cache);
          cache.length = 0;
        } else {
          const record = buildSubmitRecord(fileMeta);
          if (record.length) {
            cache.push(record);
          }
        }
        newFileMetas.indexedFiles.push({
          fileName: fileMeta.fileName,
          filePath: relativePath,
          fileType: fileMeta.languageId,
          fileHash: fileMeta.hash,
        });
        logger.info('pushLocalRag done =>', relativePath);
      }
    }
  }
}

export async function buildLocalIndexOfAllFiles(manual?: boolean) {
  const projRoot = getWorkspaceRoot();
  if (!projRoot) return;

  if (!manual && onBuildIndexProgress) {
    return;
  }

  console.log('start indexing =>', projRoot);

  const homeDir = getLocalRagHomeDir();
  const projectName = sanitizeFilePath(projRoot);
  const indexFilePath = `${LOCAL_RAG_STORE_DIR}/index/${projectName}/index.json`;
  const pathInfo = path.parse(projRoot);

  onBuildIndexProgress?.fire(l10n.t('initializing') + pathInfo.name);

  const getGitRempteTask = getGitRemoteUrl(projRoot).catch(() => undefined);
  const isOnline = await startRagService().catch((err) => {});
  const gitRepo = await getGitRempteTask;
  const cache: IChangedRecord[][] = [];

  if (isOnline) {
    const commonParam: ICommonParam = { gitRepo, homeDir, projectName, projectLocation: projRoot };
    const newFileMetadata: IMetadataInfo = {
      version: getCurrentPluginVersion(),
      ...commonParam,
      indexedFiles: [],
    };
    const ig = getIgnore(projRoot);
    await buildProjectIndexInfo(ig, pathInfo.dir, pathInfo.name, projRoot, commonParam, newFileMetadata, cache);
    if (cache.length) {
      await buildLocalRag(commonParam, cache);
    }
    const oldFileMetadata = readLocalRagMetadata(indexFilePath);
    if (oldFileMetadata?.indexedFiles?.length) {
      const filesPathArr = newFileMetadata.indexedFiles.map((item) => item.filePath);
      const deletedFiles = oldFileMetadata.indexedFiles
        .filter((item) => !filesPathArr.includes(item.filePath))
        .map((item) => item.filePath);
      if (deletedFiles.length) {
        // console.log('=================== deleteLocalRagContent');
        deleteLocalRagContent({ ...commonParam, deletedFiles });
      }
    }
    // submit end
    buildLocalRag(commonParam);
    saveLocalRagMetadata(indexFilePath, newFileMetadata);
    if (onBuildIndexProgress) {
      setTimeout(() => {
        vscode.window.showInformationMessage(l10n.t('indexDone', { projectName: pathInfo.name }), l10n.t('dismiss'));
      }, 500);
    }
  } else {
    logger.error('Failed to start local rag service!');
  }
}

export function buildLocalIndexOfAllFilesWithProgress() {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
    },
    (progress, token) => {
      const abortController = new AbortController();
      token.onCancellationRequested(() => {
        abortController.abort();
      });
      onBuildIndexProgress = new EventEmitter<string>();
      onBuildIndexProgress.event((message) => {
        progress.report({ message });
      });
      return buildLocalIndexOfAllFiles(true).finally(() => {
        onBuildIndexProgress = null;
      });
    }
  );
}
