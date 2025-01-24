import path from 'path';
import fs from 'fs';
import { logger } from './logger';

export function findFileUpwards(filename: string, startFile: string, rootDir: string) {
  let currentDir = path.dirname(startFile);
  while (true) {
    const filePath = path.join(currentDir, filename);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
    currentDir = path.dirname(currentDir);
    // if root reached, stop searching;
    if (currentDir === rootDir) {
      return;
    }
  }
}

export function readFileContentPartly(filePath: string, startIndex: number, endIndex: number) {
  try {
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' });
    if (content) {
      return content.substring(startIndex, endIndex);
    }
  } catch (error) {
    logger.error(error);
  }
}
