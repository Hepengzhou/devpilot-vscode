import vscode, { ExtensionContext, InlineCompletionTriggerKind } from 'vscode';
import { AdditionalContextItem, getCompletionsV2, predict } from '@/services/completion';
import { logger } from '@/utils/logger';
import { safeParse, sanitizeFilePath, sleep } from '@/utils';
import { trackCompletionAcceptance } from '../../services/tracking';
import globalState from '@/services/globalState';
import eventsProvider from '@/providers/EventsProvider';
import { getLanguageForMarkdown } from '@/utils/mapping';
import { AUTH_ON } from '@/env';
import { checkingNetwork } from '@/utils/network';
import RichInlineCompletionProvider from './richProvider';
import { FE_FILE_LANGS } from '@/utils/consts';
import { resolveSymbolsDefinition } from '@/services/reference';
import { getLocalRagContent, getLocalRagHomeDir } from '@/services/rag';
import path from 'path';
import { readFileContentPartly } from '@/utils/file';
import { getCurrentWorkspace } from '@/utils/vscode-extend';

export default class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private _context: vscode.ExtensionContext;
  private _lastTriggerId = 0;
  private _cancelToken?: AbortController;
  private _lockCompletion?: boolean = false;
  private _richPrivider: RichInlineCompletionProvider;
  private lastCompletionItem: {
    messageId: string;
    completionItem: vscode.InlineCompletionItem;
  } | null = null;

  constructor(context: ExtensionContext) {
    this._richPrivider = new RichInlineCompletionProvider(context);
    this._context = context;
    this.lastCompletionItem = null;
    this.initialize();
  }

  initialize() {
    this._context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, this));
    this._context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.inline.completion.accept', (e) => {
        if (this.lastCompletionItem) {
          logger.debug('=== Completion item accepted');
          this.lockMilliseconds();
          trackCompletionAcceptance(
            this.lastCompletionItem.messageId,
            getLanguageForMarkdown(vscode.window.activeTextEditor!.document.languageId)
          );
          this.lastCompletionItem = null;
        }
      })
    );
    this._context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        this._cancelToken?.abort();
      })
    );
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    logger.debug('=== provideInlineCompletionItems triggered');

    if (position.line <= 0 || this._lockCompletion) return;

    const isAutomatic = context.triggerKind === InlineCompletionTriggerKind.Automatic;

    this._lastTriggerId++;
    const triggerId = this._lastTriggerId;

    if (isAutomatic) {
      await sleep(1000);
    }

    if (triggerId !== this._lastTriggerId) {
      // Cancel this trigger if there is a new trigger
      return;
    }

    if (AUTH_ON) {
      const { token: loginToken } = globalState.loginInfo;
      if (!loginToken) return;
    }

    const config = vscode.workspace.getConfiguration('devpilot');
    const autoComplete = config.get<boolean>('autoCompletion');
    if (!autoComplete) return;

    const lineText = document.lineAt(position.line).text;
    const amongCharacters = lineText[position.character]?.trim();
    if (amongCharacters) return;

    if (isAutomatic) {
      const canTrigger = /\{|\s|\n|\r/.test(lineText[position.character - 1]);
      if (!canTrigger) return;
    }

    logger.debug('=== provideInlineCompletionItems executed!');

    this._cancelToken?.abort();
    const abortController = new AbortController();
    this._cancelToken = abortController;

    const onEnd = () => {
      this._richPrivider.setLoading(false);
      eventsProvider.onFetchCompletion.fire('END');
      abortController.abort();
    };

    abortController.signal.addEventListener('abort', onEnd);
    token.onCancellationRequested(onEnd);

    const workspace = getCurrentWorkspace(document.uri.fsPath);
    const workspaceRoot = workspace?.uri.fsPath;
    const workspaceName = workspace?.name;
    const cursorCharIndex = document.offsetAt(position);
    const reqStart = Date.now();
    const docText = document.getText();

    eventsProvider.onFetchCompletion.fire('START');

    const additionalContext: AdditionalContextItem[] = [];
    let predictionComments: string | undefined;
    const filePath = workspaceName + document.uri.fsPath.replace(workspaceRoot!, '');
    if (!isAutomatic && FE_FILE_LANGS.includes(document.languageId)) {
      this._richPrivider.setLoading();
      const predictRes = await predict({
        data: {
          filePath,
          document: docText,
          position: cursorCharIndex,
        },
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        return;
      }

      // console.log('=================', predictRes);
      const jsonRes: { references: string[]; comments: string } | null = safeParse(predictRes);
      predictionComments = jsonRes?.comments;
      if (jsonRes?.references?.length) {
        const definitionsTask = resolveSymbolsDefinition({
          currentFilefsPath: document.uri.fsPath,
          abortController: abortController,
          symbols: jsonRes.references,
          docText: docText,
          startPosition: { row: position.line, column: position.character },
        });

        const commentsTask = predictionComments
          ? getLocalRagContent(
              {
                content: predictionComments,
                projectName: sanitizeFilePath(workspaceRoot!),
                homeDir: getLocalRagHomeDir(),
              },
              abortController.signal
            )
          : Promise.resolve();

        // TODO: remove import
        const definitions = await definitionsTask;
        const commentsRecallRes = await commentsTask;
        if (abortController.signal.aborted) {
          return;
        }

        if (definitions?.length) {
          definitions
            .filter((item) => !docText.includes(item.souceCode))
            .forEach((item) => {
              additionalContext.push({ scode: 1, filePath: item.fsPath, code: item.souceCode });
            });
        }

        if (commentsRecallRes?.length) {
          commentsRecallRes.forEach((item) => {
            const filePath = path.join(workspaceRoot!, item.filePath);
            const code = readFileContentPartly(filePath, item.startOffset, item.endOffset);
            if (code) {
              additionalContext.push({ scode: 1, filePath, code });
            }
          });
        }
        // console.log('==============', definitions, commentsRecallRes);
      }
    }

    const res = await getCompletionsV2(
      {
        document: docText,
        filePath,
        language: document.languageId,
        position: cursorCharIndex!,
        completionType: 'comment',
        additionalContext,
      },
      abortController.signal
    ).catch((err) => {
      console.error(err);
      const { authType } = globalState.loginInfo;
      checkingNetwork(authType!);
      return null;
    });

    onEnd();

    logger.info('req time costs:', (Date.now() - reqStart) / 1000);
    logger.info('req response:', res?.data);

    const textToInsert = res?.data?.content?.trimStart();
    const messageId = res?.data?.id;

    logger.info('InlineCompletions =>', textToInsert);

    if (!textToInsert) return;

    const completionItem = new vscode.InlineCompletionItem(
      textToInsert,
      new vscode.Range(position, position.translate(0, textToInsert.length)),
      {
        title: 'By DevPilot',
        command: 'devpilot.inline.completion.accept',
      }
    );

    this.lastCompletionItem = {
      messageId: messageId!,
      completionItem,
    };

    this._richPrivider.clearDecoration();
    return [completionItem];
  }

  lockMilliseconds(milliseconds: number = 500) {
    this._lockCompletion = true;
    setTimeout(() => {
      this._lockCompletion = false;
    }, milliseconds);
  }
}
