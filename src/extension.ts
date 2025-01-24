import * as vscode from 'vscode';
import { logger } from './utils/logger';
import Devpilot from './devpilot';
import WelcomeViewProvider from './authentication/welcome';
import LoginController from './authentication/controller';
import statusBar from './statusbar';
import InlineCompletionProvider from './completion/inline/provider';
import CodeLensProvider from './providers/CodeLensProvider';
import globalState from './services/globalState';
import IndexerProvider from './providers/IndexerProvider';

export function activate(context: vscode.ExtensionContext) {
  logger.setProductionMode(context.extensionMode === vscode.ExtensionMode.Production);
  globalState.initialize(context);
  LoginController.create(context);

  vscode.window.onDidChangeWindowState((event) => {
    if (event.focused) {
      LoginController.instance.updateLoginStatus({ inform: false });
    }
  });

  new Devpilot(context);
  new WelcomeViewProvider(context);

  statusBar.create(context);

  new InlineCompletionProvider(context);
  new CodeLensProvider(context);
  new IndexerProvider(context);

  // __dirname is the extensionPath
  logger.debug('Activated');
}

export function deactivate() {}
