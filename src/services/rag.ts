import { API } from '@/env';
import { logger } from '@/utils/logger';
import { getLanguageForFileExtension } from '@/utils/mapping';
import request, { requestV2 } from '@/utils/request';
import path from 'path';
import { Worker } from 'worker_threads';
import globalState from './globalState';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

export const RAG_SUPPORTED_LANGS = ['javascript', 'typescript', 'typescriptreact', 'javascriptreact'];
export const DEFAULT_PROJECT_TYPE = 'javascript';
export const LOCAL_RAG_STORE_DIR = 'local_rag';

const LOCAL_RAG_PORT_SEED = Math.ceil(Math.random() * 40000) + 10000;
const LOCAL_RAG_VERSION = '1.1.0';

export async function isRepoEmbedded(repo: string) {
  const repoRes = await request()
    .get(`${API}/devpilot/v1/rag/git_repo/embedding_info/${repo}`)
    .catch((err) => {
      logger.error(err);
      return { data: { embedded: false } };
    });
  logger.info('isRepoEmbedded', repoRes.data);
  return repoRes.data.embedded;
}

export function getProjectType(ext?: string) {
  if (!ext) return DEFAULT_PROJECT_TYPE;
  const lang = getLanguageForFileExtension(ext);
  if (RAG_SUPPORTED_LANGS.includes(lang)) {
    return DEFAULT_PROJECT_TYPE;
  }
  return lang || DEFAULT_PROJECT_TYPE;
}

export function getLocalRagHomeDir() {
  const homeDir = path.join(globalState.globalStoragePath, LOCAL_RAG_STORE_DIR);
  return homeDir;
}

function getLocalRagServiceBase() {
  const port = globalState.get('rag-port') || LOCAL_RAG_PORT_SEED;
  // const port = 3000;
  return `http://localhost:${port}`;
}

let childProcess: Worker;
let startLocalRagServiceTask: Promise<boolean> | undefined;

export function startLocalRagService(port: number, tryTimes: number = 0): Promise<boolean> {
  if (startLocalRagServiceTask) return startLocalRagServiceTask;
  startLocalRagServiceTask = new Promise<boolean>((resolve, reject) => {
    logger.info('Try to start local rag service at port:', port);
    const workerPath = path.join(__dirname, './resources/devpilot-agent.js');
    const worker = new Worker(workerPath, { argv: [`--port=${port}`, `--env=${process.env.NODE_ENV === 'development' ? 'test' : 'prd'}`] });
    const timer = setTimeout(() => reject(new Error('Time out!')), 3000);
    childProcess?.terminate();
    childProcess = worker;
    worker.on('message', (e) => {
      clearTimeout(timer);
      if (e.success) {
        globalState.set('rag-port', port);
        resolve(true);
      } else {
        worker.terminate();
        reject(e.error);
      }
      startLocalRagServiceTask = undefined;
    });
  }).catch((err) => {
    startLocalRagServiceTask = undefined;
    logger.error('startLocalRagService', err);
    if (/EADDRINUSE/.test(err?.message) && tryTimes < 5) {
      // return startLocalRagService(port + 1, tryTimes + 1);
      return startLocalRagService(port + Math.ceil(Math.random() * 10000), tryTimes + 1);
    }
    return false;
  });
  return startLocalRagServiceTask;
}

export function killLocalRagService() {
  try {
    childProcess?.terminate();
  } catch (error) {
    logger.error(error);
  }
}

async function detectLocalRagService() {
  if (!globalState.get('rag-port')) return false;
  const isRightVersionOnline = await requestV2
    .get(`${getLocalRagServiceBase()}/health`)
    .then((res) => {
      // compare version in case some vscode instances have been restarted while the others not.
      return res.status === 200 && res.data.version === LOCAL_RAG_VERSION;
    })
    .catch((err) => {
      logger.error('detectLocalRagService =>', err);
      return false;
    });
  return isRightVersionOnline;
}

export async function startRagService() {
  return detectLocalRagService()
    .then((isOnDuty) => {
      return isOnDuty ? true : startLocalRagService(LOCAL_RAG_PORT_SEED);
    })
    .then((isOnDuty) => {
      if (isOnDuty) {
        logger.info('Local rag service is online!', globalState.get('rag-port'));
        return Promise.resolve(true);
      }
      return Promise.reject(new Error('Failed to start local rag service'));
    });
}

export async function invokeLocalAgent<TRes = any>(api: string, config: AxiosRequestConfig<any>) {
  return startRagService().then((inOnline) => {
    if (inOnline) {
      return requestV2<any, AxiosResponse<TRes>>({ ...config, url: getLocalRagServiceBase() + api });
    }
  });
}

export async function getRemoteRagContent(
  data: { content?: string; selectedCode?: string; projectType?: string; projectName?: string; predictionComments?: string },
  abortController?: AbortController
) {
  return startRagService()
    .then((inOnline) => {
      if (inOnline) {
        return requestV2
          .post(`${getLocalRagServiceBase()}/rag`, data, { signal: abortController?.signal })
          .then((res) => res.data as any[]);
      }
    })
    .catch((err) => {
      logger.error(err);
    });
}

export async function getLocalRagContent(
  data: { content?: string; selectedCode?: string; projectName: string; homeDir: string },
  signal?: AbortSignal
) {
  if (data.content || data.selectedCode) {
    return startRagService()
      .then((inOnline) => {
        if (inOnline) {
          return requestV2.post(`${getLocalRagServiceBase()}/local-rag`, data, { signal }).then((res) => {
            return res.data.hitsData as IChangedRecord[];
          }); // IChangedRecord's partial fields
        }
      })
      .catch((err) => {
        logger.error(err);
      });
  }
}

export async function buildRagContent(originalInputs: string[]): Promise<{ embedding: number[]; index: number; object: 'embedding' }[]> {
  if (!originalInputs.length) return [];
  return startRagService()
    .then((inOnline) => {
      if (inOnline) {
        return requestV2.post(`${getLocalRagServiceBase()}/embedding`, { originalInputs }).then((res) => res.data);
      }
    })
    .catch((err) => {
      logger.error(err);
    });
}

export interface IChangedRecord {
  recordId: string;
  filePath: string;
  fileHash: string;
  code: string;
  chunkHash: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endColumn: number;
  endLine: number;
  comments?: string;
}

export async function buildLocalRagContent(data: {
  batchId: string;
  homeDir: string;
  projectName: string;
  gitRepo?: string;
  submitEnd: boolean;
  changedRecords?: Record<string, IChangedRecord[]>;
}) {
  // return requestV2.post(`http://localhost:3000/submitChunks`, data).then((res) => res.data);
  return requestV2.post(`${getLocalRagServiceBase()}/submitChunks`, data).then((res) => res.data);
}

export async function deleteLocalRagContent(data: { homeDir: string; projectName: string; gitRepo?: string; deletedFiles: string[] }) {
  return requestV2.post(`${getLocalRagServiceBase()}/deleteChunks`, data).then((res) => res.data);
}

export async function resetLocalRagContent(data: { homeDir: string; projectName: string; gitRepo?: string }) {
  return requestV2.post(`${getLocalRagServiceBase()}/reset-index`, data).then((res) => res.data);
}
