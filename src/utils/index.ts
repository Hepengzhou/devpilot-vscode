import vscode from 'vscode';
import { CodeReference } from '@/typing';
import { getLanguageForMarkdown } from './mapping';
import path from 'path';

export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getConfiguration<T>(key: string, fallback?: any) {
  const config = vscode.workspace.getConfiguration('devpilot');
  const ret = config.get<T>(key) ?? fallback;
  return ret;
}

export function toBase64(text: string) {
  return Buffer.from(text).toString('base64');
}

export function safeParse(json: any | undefined, fallback: any = null) {
  if (json) {
    try {
      return JSON.parse(json);
    } catch (error) {
      console.error(error);
    }
  }
  return fallback;
}

export function removeComments(jsonString: string) {
  let noSingleLineComments = jsonString.replace(/\/\/.*$/gm, '');
  let noComments = noSingleLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return noComments;
}

export function wrapInCodeblock(lang: string, code: string) {
  return `\`\`\`${lang}\n${code}\n\`\`\``;
}

export function wrapCodeRefInCodeblock(codeRef?: Pick<CodeReference, 'languageId' | 'sourceCode'>) {
  if (codeRef) {
    return wrapInCodeblock(getLanguageForMarkdown(codeRef.languageId), codeRef.sourceCode);
  }
  return;
}

export function addIndentation(text: string, indentLen: number) {
  const indentation = new Array(indentLen).fill(' ').join('');
  return text
    .split('\n')
    .map((line: string) => indentation + line)
    .join('\n');
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function sanitizeFilePath(path: string): string {
  const invalidChars = /[:\\/\s.]/g;
  return path.replace(invalidChars, '_');
}

export function removeUnexpectedContent(jsonLikeString: string) {
  if (jsonLikeString) {
    // to make sure the result is a pure json string;
    const firstIndex = jsonLikeString.indexOf('{');
    if (firstIndex !== 0) {
      jsonLikeString = jsonLikeString.substring(firstIndex);
    }
    const lastIndex = jsonLikeString.indexOf('}');
    if (lastIndex !== jsonLikeString.length - 1) {
      jsonLikeString = jsonLikeString.substring(0, lastIndex + 1);
    }
  }
  return jsonLikeString;
}

export function removeStartSepOfFsPath(fsPath: string) {
  if (fsPath.startsWith(path.sep)) {
    fsPath = fsPath.substring(1);
  }
  return fsPath;
}
