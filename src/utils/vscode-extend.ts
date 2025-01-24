/**
 * Encapsulate some VSCode APIs to simplify usage
 */

import { CodeReference } from '@/typing';
import { basename } from 'path';
import vscode from 'vscode';
import { removeStartSepOfFsPath } from '.';

export function createFullLineRange(row: number) {
  const start = new vscode.Position(row, 0);
  const end = new vscode.Position(row, Number.MAX_SAFE_INTEGER);
  return new vscode.Range(start, end);
}

export function selectRange(range: vscode.Range) {
  let editor = vscode.window.activeTextEditor;
  if (editor) {
    editor.selection = new vscode.Selection(range.start, range.end);
  }
}

export function getCurrentPluginVersion() {
  const extension = vscode.extensions.getExtension('Zhongan.devpilot');
  return extension?.packageJSON?.version || '0.0.1';
}

export function getCurrentWorkspace(fsPath?: string): vscode.WorkspaceFolder | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    return undefined;
  }

  fsPath = fsPath || vscode.window.activeTextEditor?.document.uri.fsPath;
  if (fsPath) {
    for (const folder of workspaceFolders) {
      if (fsPath.startsWith(folder.uri.fsPath)) {
        return folder;
      }
    }
  }

  return workspaceFolders[0];
}

export function getWorkspaceRoot(fsPath?: string): string | undefined {
  const workspace = getCurrentWorkspace(fsPath);
  return workspace?.uri.fsPath;
}

export function getIdeTheme() {
  return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? 'dark' : 'light';
}

export const getCodeRef = (editor: vscode.TextEditor, codeRef?: Partial<CodeReference>): CodeReference => {
  const sourceCode = editor.document.getText(editor.selection);
  const newCodeRef: CodeReference = {
    languageId: editor.document.languageId,
    fileUrl: editor.document.uri.fsPath,
    fileName: basename(editor.document.uri.fsPath),
    document: editor.document.getText(),
    sourceCode,
    selectedStartLine: editor.selection.start.line,
    selectedStartColumn: editor.selection.start.character,
    selectedEndLine: editor.selection.end.line,
    selectedEndColumn: editor.selection.end.character,
    // visible: true,
    ...codeRef,
  };

  const workspace = getCurrentWorkspace(editor.document.uri.fsPath);
  if (workspace) {
    newCodeRef.filePath = removeStartSepOfFsPath(editor.document.uri.fsPath.replace(workspace.uri.fsPath, ''));
  }

  return newCodeRef;
};
