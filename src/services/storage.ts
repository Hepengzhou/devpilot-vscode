import fs from 'fs';
import path, { dirname } from 'path';
import globalState from './globalState';
import { logger } from '@/utils/logger';

export interface IFileMetadata {
  hash: string;
  fsPath?: string;
}

export type Metadata = Record<string, IFileMetadata>;

export interface IMetadataInfo {
  version: string;
  projectName: string;
  gitRepo?: string;
  indexedFiles: Array<{
    fileName: string;
    filePath: string;
    fileType: string;
    fileHash: string;
  }>;
}

export function saveFile<T = any>(fileName: string, metadata: T) {
  try {
    let storagePath = path.join(globalState.globalStoragePath, dirname(fileName));
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
    fs.writeFile(path.join(globalState.globalStoragePath, fileName), JSON.stringify(metadata, null, 2), { encoding: 'utf-8' }, () => {});
  } catch (error) {
    logger.error(error);
  }
}

export function readFile<T = any>(fileName: string): T | null {
  try {
    let filePath = path.join(globalState.globalStoragePath, fileName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(text);
  } catch (error) {
    logger.error(error);
    return null;
  }
}

export function readFileRagMetadata(fileName: string) {
  return readFile<IFileMetadata>(fileName);
}

export function saveFileRagMetadata(fileName: string, metadata: any) {
  saveFile<IFileMetadata>(fileName, metadata);
}

export function readLocalRagMetadata(fileName: string) {
  return readFile<IMetadataInfo>(fileName);
}

export function saveLocalRagMetadata(fileName: string, metadata: any) {
  saveFile<IMetadataInfo>(fileName, metadata);
}
