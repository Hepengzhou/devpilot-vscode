import vscode, { ExtensionContext } from 'vscode';
import l10n from '@/l10n';
import path from 'path';

export default class RichInlineCompletionProvider {
  iconDecorationTypeLoading: vscode.TextEditorDecorationType;
  iconDecorationType: vscode.TextEditorDecorationType;
  private _context: vscode.ExtensionContext;
  instance: RichInlineCompletionProvider;

  constructor(context: ExtensionContext) {
    this._context = context;
    this.instance = this;
    const gutterIconPath = path.join(context.extensionPath, 'assets', 'loading.gif');
    const shortcut = process.platform === 'darwin' ? '⌥+\\ ' : 'Alt+\\ ';
    this.iconDecorationTypeLoading = vscode.window.createTextEditorDecorationType({
      gutterIconPath,
      gutterIconSize: '80%',
    });
    this.iconDecorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: shortcut + l10n.t('decoration.shortcuts.inline'),
        margin: '0 0 0 3em',
        color: 'rgba(153, 153, 153, 0.35)',
      },
    });
    this.initialize();
  }

  initialize() {
    this._context.subscriptions.push(this);
    this._context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.updateDecoration(event.textEditor);
      })
    );
    setTimeout(() => {
      this.updateDecoration(vscode.window.activeTextEditor);
    }, 1000);
  }

  updateDecoration(editor?: vscode.TextEditor) {
    if (editor) {
      if (editor.selection.isSingleLine) {
        const cursorPosition = editor.selection.active;
        const line = editor.document.lineAt(cursorPosition.line);
        const lineText = line.text.trimEnd();
        const canTrigger = !/[};]$/.test(lineText) && editor.selection.active.character >= lineText.length;
        editor.setDecorations(this.iconDecorationType, canTrigger ? [line.range] : []);
      } else {
        editor.setDecorations(this.iconDecorationType, []);
      }
    }
  }

  clearDecoration() {
    vscode.window.activeTextEditor?.setDecorations(this.iconDecorationType, []);
  }

  setLoading(loading?: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (loading === false) {
        editor.setDecorations(this.iconDecorationTypeLoading, []);
      } else {
        const cursorPosition = editor.selection.active;
        const line = editor.document.lineAt(cursorPosition.line);
        editor.setDecorations(this.iconDecorationTypeLoading, [line.range]);
      }
    }
  }

  dispose() {
    this.iconDecorationType.dispose();
  }
}
