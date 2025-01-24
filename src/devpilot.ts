import path, { join, basename, extname } from 'path';
import vscode from 'vscode';
import fs from 'fs';
import { getCurrentConversation, startNewConversation } from '@/conversation/conversation';
import { createAssistantMessage, createDividerMessage, createSystemMessage } from '@/completion/messages';
import { buildRecallMessage, messageByFunctionality } from '@/completion/promptBuilder';
import { Configuration, configuration } from './configuration';
import { createUserMessage } from './completion/messages';
import { CodeReference, PluginCommand, ChatMessage, DevPilotFunctionality, LLMChatHandler, IRecall } from './typing';
import l10n from './l10n';
import { getLanguageForFileExtension, getLanguageForMarkdown } from './utils/mapping';
// import { getRepositoryName } from './utils/git';
// import { isRepoEmbedded } from './services/rag';
import { logger } from './utils/logger';
import { trackCodeAction, trackLiking } from './services/tracking';
import eventsProvider from '@/providers/EventsProvider';
import { getCodeRef, getCurrentPluginVersion, getIdeTheme, getWorkspaceRoot } from './utils/vscode-extend';
import { generateCommitMsg, NO_STAGED_FILES, predictV2 } from './services/chat';
import { notifyLogin } from './services/login';
import { addIndentation, safeParse, sanitizeFilePath, sleep } from './utils';
import { definitions2CodeReferences, resolveSymbolsDefinition } from './services/reference';
import { getLocalRagContent, getLocalRagHomeDir, getProjectType, getRemoteRagContent } from './services/rag';
import { md5 } from './utils/md5';
import globalState from './services/globalState';
import { readFileContentPartly } from './utils/file';
import { findPredictableCodeRefs, openOfficialSite } from './services/common';

export default class Devpilot implements vscode.WebviewViewProvider {
  private _context: vscode.ExtensionContext;
  private extensionUri: vscode.Uri;
  private view: vscode.WebviewView | null;
  private chatHandler?: LLMChatHandler;
  private config: Configuration;
  private chatAbortController: AbortController | null = null;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this.extensionUri = context.extensionUri;
    this.view = null;
    this.config = configuration(context);
    eventsProvider.configChange.event((e) => this.onConfigChanged(e.key, e.data));
    this.initialize();
  }

  async initialize() {
    logger.debug('devpilot.initialize');

    eventsProvider.onLogin.event((status) => {
      if (status === 1) {
        const loginType = globalState.get('LOGIN_TYPE') as string;
        const loginTypeName = { gzh: '微信公众号', za: '众安保险', zati: 'ZATI' }[loginType];
        const userName = globalState.get('USER_NAME');
        this.onConfigChanged('username', userName);
        this.appendChatMessage(
          createAssistantMessage({
            content: `[C]${loginTypeName} ${l10n.t('login.success')}: ${userName}`,
          })
        );
      } else {
        this.clearAllChatHistory();
      }
    });

    this._context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('devpilot-chat', this, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      })
    );

    this._context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.onThemeChanged(getIdeTheme());
      })
    );

    this.registerCommands(this._context);

    // this.repoName = await getRepositoryName();
    // logger.debug('repoName', this.repoName);
    // if (this.config.llm().name === 'ZA') {
    //   this.repoEmbedded = await isRepoEmbedded(this.repoName);
    // } else {
    //   logger.debug("Don't check repo embedding for non-ZA provider");
    //   this.repoEmbedded = false;
    // }
    // logger.debug('repoEmbedded', this.repoEmbedded);
  }

  onThemeChanged(theme: string) {
    this.postPluginMessage({
      command: PluginCommand.ThemeChanged,
      payload: { theme },
    });
  }

  onConfigChanged(key: string, value: any) {
    if (key === 'language') {
      this.postPluginMessage({
        command: PluginCommand.LocaleChanged,
        payload: { locale: this.config.locale() },
      });
    } else if (key === 'username') {
      this.postPluginMessage({
        command: PluginCommand.ConfigurationChanged,
        payload: { username: value },
      });
    }
  }

  registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.openChat', async () => {
        this.starConversationOf(DevPilotFunctionality.OpenChat);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.referenceCode', async () => {
        this.starConversationOf(DevPilotFunctionality.ReferenceCode);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.explainCode', () => {
        this.starConversationOf(DevPilotFunctionality.ExplainCode);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.fixCode', () => {
        this.starConversationOf(DevPilotFunctionality.FixCode);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.generateTest', () => {
        this.starConversationOf(DevPilotFunctionality.GenerateTest);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.checkPerformance', () => {
        this.starConversationOf(DevPilotFunctionality.CheckPerformance);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.codeReview', () => {
        this.starConversationOf(DevPilotFunctionality.ReviewCode);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.commentCode', () => {
        this.starConversationOf(DevPilotFunctionality.CommentCode);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.commentMethod', () => {
        this.starConversationOf(DevPilotFunctionality.CommentMethod);
      })
    );

    let _generateCommitMsgController: AbortController | undefined;
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.generateCommitMsg', (e) => {
        _generateCommitMsgController?.abort();
        _generateCommitMsgController = new AbortController();
        vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl, cancellable: true }, (_, token) => {
          token.onCancellationRequested(() => {
            _generateCommitMsgController?.abort();
          });
          vscode.commands.executeCommand('setContext', 'devpilot.isGeneratingCommit', 1);
          return generateCommitMsg({ signal: _generateCommitMsgController?.signal })
            .then((res) => {
              if (res === NO_STAGED_FILES) {
                vscode.window.showInformationMessage(l10n.t('git.nostaged'));
              } else if (res) {
                logger.info('commit message', res);
                e.inputBox.value = res;
              }
            })
            .finally(() => {
              vscode.commands.executeCommand('setContext', 'devpilot.isGeneratingCommit', 0);
            });
        });
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.abortCommitMsg', () => {
        _generateCommitMsgController?.abort();
        vscode.commands.executeCommand('setContext', 'devpilot.isGeneratingCommit', 0);
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.feedback', () => {
        openOfficialSite('/feedback');
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.openPersonal', () => {
        openOfficialSite('/profile');
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('devpilot.openSetting', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'devpilot');
      })
    );
  }

  async reveal() {
    if (!this.view) {
      await vscode.commands.executeCommand('devpilot-chat.focus');
      await sleep(500); // ensure to be fully initialized
    } else if (!this.view.visible) {
      this.view.show(true);
    }
  }

  postPluginMessage(msg: { command: PluginCommand; payload: any }) {
    this.view?.webview.postMessage(msg);
  }

  /**
   * @returns return false if not to recall, return undefined if aborted
   */
  async handleRecall(options: {
    content?: string;
    codeRefs?: CodeReference[];
    mode?: ChatMessage['mode'];
    functionality: DevPilotFunctionality;
  }) {
    const { content, codeRefs, functionality, mode } = options;
    if (mode === 'with-ctrl') return false;

    const predictableCodeRefs = findPredictableCodeRefs(codeRefs);
    const hasLocalRecall = predictableCodeRefs.length > 0;
    const hasRemoteRecall = [DevPilotFunctionality.PureChat].includes(functionality); // recall from simple code

    if (!hasLocalRecall && !hasRemoteRecall) {
      return false;
    }

    logger.info('handleRecall', hasLocalRecall, hasRemoteRecall);

    const convo = getCurrentConversation();
    const recall: IRecall = { steps: [{ status: 'loading' }] };
    convo.addMessage(createAssistantMessage({ recall, streaming: true }));
    this.renderConversation();

    const abortController = new AbortController();
    this.chatAbortController = abortController;

    let predictionComments: string | undefined;

    const setAborted = () => {
      recall.steps[recall.steps.length - 1].status = 'terminated';
      convo.replaceToLastMessage({ recall }, false);
      this.renderConversation();
    };

    // for not yet enter streaming state
    abortController.signal.addEventListener('abort', setAborted);

    // no dependency, go first!
    const workspaceRoot = getWorkspaceRoot();
    const lastCodeRef = codeRefs?.length ? codeRefs[codeRefs.length - 1] : undefined;
    const hasLocalRag = workspaceRoot && this.config.localRAG();
    const localRagTask = hasLocalRag
      ? getLocalRagContent(
          {
            content,
            selectedCode: lastCodeRef?.sourceCode,
            projectName: sanitizeFilePath(workspaceRoot),
            homeDir: getLocalRagHomeDir(),
          },
          abortController.signal
        )
      : Promise.resolve();

    if (hasLocalRecall && codeRefs && lastCodeRef) {
      const predictRes = await predictV2({
        message: buildRecallMessage({ codeRefs, functionality }),
        signal: abortController.signal,
      });

      if (abortController.signal.aborted) {
        return;
      }

      const jsonRes: { references: string[]; comments: string } | null = safeParse(predictRes);
      predictionComments = jsonRes?.comments;
      logger.info('recalled symbols:', jsonRes);
      if (jsonRes?.references?.length) {
        const definitionsTask = resolveSymbolsDefinition({
          currentFilefsPath: lastCodeRef.fileUrl,
          abortController: abortController,
          symbols: jsonRes.references,
          docText: lastCodeRef.document!,
          startPosition:
            lastCodeRef.selectedStartColumn - 1 > 0
              ? { row: lastCodeRef.selectedStartLine, column: lastCodeRef.selectedStartColumn - 1 }
              : { row: lastCodeRef.selectedStartLine - 1, column: -1 },
        });

        recall.steps = [{ status: 'done' }, { status: 'loading' }];
        convo.replaceToLastMessage({ recall }, true);
        this.renderConversation();

        const definitions = await definitionsTask;
        if (abortController.signal.aborted) {
          return;
        }

        logger.info('recalled definitions:', definitions);
        if (definitions?.length) {
          recall.localRefs = definitions2CodeReferences(definitions);
          logger.info('recalled localRefs:', recall.localRefs);
        }
      }
    }

    if (hasRemoteRecall) {
      const remoteRes = await getRemoteRagContent(
        {
          predictionComments,
          content,
          selectedCode: lastCodeRef?.sourceCode,
          projectType: getProjectType(lastCodeRef?.fileName.split('.').pop()),
          projectName: workspaceRoot ? md5(workspaceRoot) : '',
        },
        abortController
      );

      if (abortController.signal.aborted) {
        return;
      }

      if (remoteRes?.length) {
        logger.info('remote rag res', remoteRes);
        const remoteRefs: CodeReference[] = [];
        remoteRes.forEach((item) => {
          if (!remoteRefs.find((oldItem) => oldItem.sourceCode === item.code)) {
            const langId = item.fileName ? getLanguageForFileExtension(extname(item.fileName)) : 'plaintext';
            remoteRefs.push({
              languageId: getLanguageForMarkdown(langId),
              fileUrl: item.filePath,
              fileName: item.fileName,
              sourceCode: item.code,
            } as CodeReference);
          }
        });
        recall.remoteRefs = remoteRefs;
      }
    }

    const locaRagRes = await localRagTask;
    if (abortController.signal.aborted) {
      return;
    }

    if (locaRagRes?.length) {
      const localRefs: CodeReference[] = recall.localRefs || [];
      locaRagRes.forEach((item) => {
        const fileUrl = path.join(workspaceRoot!, item.filePath);
        const code = readFileContentPartly(fileUrl, item.startOffset, item.endOffset);
        if (code) {
          const langId = getLanguageForFileExtension(extname(item.filePath));
          localRefs.push({
            languageId: langId,
            fileUrl,
            fileName: basename(item.filePath),
            sourceCode: code,
            selectedStartLine: item.startLine,
            selectedStartColumn: item.startColumn,
            selectedEndLine: item.endLine,
            selectedEndColumn: item.endColumn,
          } as CodeReference);
        }
      });
      recall.localRefs = localRefs;
      // console.log('locaRagRes ==> ', locaRagRes);
    }

    recall.steps = [{ status: 'done' }, { status: 'done' }, { status: 'loading' }];
    convo.replaceToLastMessage({ recall }, true);
    this.renderConversation();

    return { abortController, recall };
  }

  startNewConversation(initMessages?: ChatMessage[]) {
    this.chatAbortController?.abort();
    startNewConversation(initMessages);
    this.renderConversation();
  }

  async starConversationOf(functionality: DevPilotFunctionality, msg?: Partial<ChatMessage>) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    const sourceCode = editor.document.getText(editor.selection);
    if (functionality === DevPilotFunctionality.OpenChat) {
      await this.reveal();
      if (sourceCode) {
        this.postPluginMessage({ command: PluginCommand.ReferenceCode, payload: getCodeRef(editor) });
      }
      return;
    }

    if (!sourceCode) {
      vscode.window.showErrorMessage(l10n.t('msg.empty_selection'));
      return;
    }

    await this.reveal();

    if (functionality === DevPilotFunctionality.ReferenceCode) {
      this.postPluginMessage({ command: PluginCommand.ReferenceCode, payload: getCodeRef(editor) }); // the same to OpenChat
    } else {
      const codeRef = msg?.codeRefs?.[0] || getCodeRef(editor);
      const codeRefs = [codeRef];

      const initMsg = createUserMessage({
        content: messageByFunctionality(functionality) + (msg?.content ? ', ' + msg.content : ''),
        codeRefs,
        commandType: functionality,
      });

      this.startNewConversation([initMsg]);

      const recallRes = await this.handleRecall({ codeRefs, functionality, mode: msg?.mode });
      if (recallRes === false) {
        this.streamingBotAnswerIntoConversation();
      } else if (recallRes) {
        this.streamingBotAnswerIntoConversation(recallRes.abortController, { recall: recallRes.recall });
      }
    }
  }

  public async appendChatMessage(msg: ChatMessage) {
    const convo = getCurrentConversation();
    convo.addMessage(msg);
    this.renderConversation();
  }

  deleteChatMessage(msg: ChatMessage) {
    const convo = getCurrentConversation();
    const currMsg = convo.getMessageByID(msg.id);
    if (!currMsg) {
      return;
    }
    if (msg.role !== 'user') {
      return;
    }
    const deleted = convo.deletePairMessage(msg);
    if (!deleted) {
      return;
    }
    const [msg1, msg2] = deleted;
    if (msg1.streaming || msg2.streaming) {
      this.interruptChatStream();
    }
    this.renderConversation();
  }

  regenerateChatMessage(msg: ChatMessage) {
    const convo = getCurrentConversation();
    const currMsg = convo.getMessageByID(msg.id);
    if (!currMsg) {
      return;
    }
    if (msg.role !== 'assistant') {
      return;
    }
    if (currMsg.streaming) {
      this.interruptChatStream();
    }
    convo.deleteMessage(msg);
    this.renderConversation();
    this.streamingBotAnswerIntoConversation();
  }

  clearChatHistory() {
    const convo = getCurrentConversation();
    if (!convo.lastMessage || convo.lastMessage.role === 'divider') {
      return;
    }
    convo.addMessage(createDividerMessage());
    this.renderConversation();
  }

  clearAllChatHistory() {
    const convo = getCurrentConversation();
    convo.clearAllMessages();
  }

  renderConversation() {
    const convo = getCurrentConversation();
    let renderMessages = convo.messages.map((msg) => ({
      ...msg,
      content: msg.content.startsWith('[C]') ? msg.content.replace('[C]', '') : msg.content,
    }));
    this.postPluginMessage({
      command: PluginCommand.RenderChatConversation,
      payload: renderMessages,
    });
  }

  async streamingBotAnswerIntoConversation(abortController?: AbortController, message?: Partial<ChatMessage>) {
    const convo = getCurrentConversation();
    if (!convo.lastMessage) {
      return;
    }

    if (!message?.recall) {
      convo.addMessage(createAssistantMessage({ content: '...' }));
      this.renderConversation();
    }

    try {
      const msgs = convo.lastSessionMessages;

      // Make sure the first message is a system message, either the one we added or the one from the previous session
      if (msgs[0].role !== 'system') {
        if (convo.messages[0].role === 'system') {
          msgs.unshift(convo.messages[0]);
        }
      }

      const llmMsgs = msgs.filter((msg) => !msg.content.startsWith('[C]') && msg.content !== '...');

      if (!abortController) {
        abortController = new AbortController();
        this.chatAbortController = abortController!;
      }

      const signal = abortController!.signal;
      const handler = await this.config.llm().chat(llmMsgs, { signal });

      handler.onText((text, { id }) => {
        convo.replaceToLastMessage({ id, content: text }, true);
        this.renderConversation();
      });

      handler.onInterrupted(() => {
        convo.interruptLastMessage();
        this.renderConversation();
      });

      this.chatHandler = handler;
      const answer = await handler.result();

      if (message?.recall) {
        message.recall.steps[2] = { status: 'done' };
      }

      convo.replaceToLastMessage({ content: answer, recall: message?.recall }, false);
      this.renderConversation();
    } catch (error: any) {
      const err = error as Error;
      console.error('LLM Error', err);

      abortController?.abort();
      if (/401/.test(err.message)) {
        const failText = `[C]${l10n.t('login.fail')}`;
        convo.replaceToLastMessage(createSystemMessage({ content: failText }));
        convo.addMessage(createUserMessage({ content: `[C]${l10n.t('chat.login')}` }));
        this.renderConversation();
        notifyLogin();
      } else {
        convo.replaceToLastMessage(createSystemMessage({ content: err.message }));
        this.renderConversation();
      }
    }
  }

  interruptChatStream() {
    this.chatAbortController?.abort();
    this.chatHandler?.interrupt();
  }

  async handleCommandFromWebview({ command, payload: msg }: { command: string; payload: any }) {
    logger.debug('Receive message =>', command, JSON.stringify(msg, null, 2));
    if (command === PluginCommand.OpenFile) {
      // open file in vscode
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found!');
        return;
      }
      const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath; // 获取第一个工作区文件夹的路径
      const filePath = vscode.Uri.file(`${workspaceFolder}/${msg.content}`);
      try {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
      } catch (error: any) {
        vscode.window.showErrorMessage('Failed to open file: ' + error.message);
      }
    } else if (command === PluginCommand.AppendToConversation) {
      if (msg.role === 'user') {
        const convo = getCurrentConversation();
        const chatMsg: ChatMessage = msg;
        // if selected code is not empty, add it to the conversation
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.getText(editor.selection)) {
          const newCodeRef = getCodeRef(editor);
          // check if referred by prev chat;
          const isCodeRefExists = convo.messages.find((m) =>
            m.codeRefs?.find((oldRef) => oldRef.sourceCode?.includes(newCodeRef.sourceCode))
          );
          if (!isCodeRefExists) {
            if (chatMsg.codeRefs) {
              // check if included by referred files
              if (!chatMsg.codeRefs.find((item) => item.sourceCode.includes(newCodeRef.sourceCode))) {
                chatMsg.codeRefs = [...chatMsg.codeRefs.filter((item) => !newCodeRef.sourceCode.includes(item.sourceCode)), newCodeRef];
              }
            } else {
              chatMsg.codeRefs = [newCodeRef];
            }
          }
        }

        chatMsg.commandType = DevPilotFunctionality.PureChat;
        convo.addMessage(chatMsg);
        this.renderConversation();

        const recallRes = await this.handleRecall({
          content: msg.content,
          codeRefs: chatMsg.codeRefs,
          functionality: DevPilotFunctionality.PureChat,
          mode: chatMsg.mode,
        });
        if (recallRes === false) {
          this.streamingBotAnswerIntoConversation();
        } else if (recallRes) {
          this.streamingBotAnswerIntoConversation(recallRes.abortController, { recall: recallRes.recall });
        }
      }
    } else if (command === PluginCommand.InterruptChatStream) {
      this.interruptChatStream();
    } else if (command === PluginCommand.DeleteMessage) {
      this.deleteChatMessage(msg);
      return;
    }
    if (command === PluginCommand.RegenerateMessage) {
      this.regenerateChatMessage(msg);
    } else if (command === PluginCommand.ClearChatHistory) {
      this.startNewConversation();
    } else if (command === PluginCommand.GotoSelectedCode) {
      let editor = vscode.window.activeTextEditor;
      const codeRef: CodeReference = msg;
      if (editor?.document.uri.fsPath !== codeRef.fileUrl) {
        let doc = vscode.workspace.textDocuments.find((item) => item.uri.fsPath === codeRef.fileUrl);
        if (!doc && fs.existsSync(codeRef.fileUrl)) {
          doc = await vscode.workspace.openTextDocument(codeRef.fileUrl);
        }
        if (doc) {
          editor = await vscode.window.showTextDocument(doc);
        }
      }
      if (editor && editor.document.uri.fsPath === codeRef.fileUrl) {
        const endLine = codeRef.selectedEndLine;
        const endCharacter = codeRef.selectedEndColumn || editor.document.lineAt(endLine).text.length;
        const startPosition = new vscode.Position(codeRef.selectedStartLine, codeRef.selectedStartColumn || 0);
        const endPosition = new vscode.Position(endLine, endCharacter);
        const selection = new vscode.Selection(startPosition, endPosition);
        editor.selection = selection;
        editor.revealRange(selection, vscode.TextEditorRevealType.Default);
      }
    } else if (command === PluginCommand.CopyCode) {
      if (msg.role === 'assistant') {
        trackCodeAction('COPY', msg.messageId, msg.content, msg.language);
      }
    } else if (command === PluginCommand.LikeMessage) {
      logger.debug('trackLiking', msg);
      trackLiking(msg.id, true);
    } else if (command === PluginCommand.DislikeMessage) {
      logger.debug('trackLiking', msg, false);
      trackLiking(msg.id, false);
    } else if (command === PluginCommand.InsertCodeAtCaret) {
      logger.debug(PluginCommand.InsertCodeAtCaret, msg);
      const editor = vscode.window.activeTextEditor;
      if (editor && msg.content) {
        editor.edit((editBuilder) => {
          let insertPosition = editor.selection.active;
          const convo = getCurrentConversation();
          const rawMsg = convo.getPrevMessageByID(msg.messageId);
          const currentCodeRef = getCodeRef(editor);
          if (!rawMsg?.codeRefs?.length || !currentCodeRef.sourceCode) {
          } else if (currentCodeRef.sourceCode) {
            const codeStartLine = editor.document.lineAt(currentCodeRef.selectedStartLine);
            insertPosition = new vscode.Position(currentCodeRef.selectedStartLine - 1, codeStartLine.firstNonWhitespaceCharacterIndex);
          }
          const cnt = addIndentation(msg.content, insertPosition.character);
          editBuilder.insert(insertPosition, cnt);
        });
      }
      trackCodeAction('INSERT', msg.messageId, msg.content, msg.language);
    } else if (command === PluginCommand.ReplaceSelectedCode) {
      logger.debug(PluginCommand.ReplaceSelectedCode, msg);
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.edit((editBuilder) => {
          editBuilder.replace(editor.selection, msg.content);
        });
      }
      trackCodeAction('REPLACE', msg.messageId, msg.content, msg.language);
    } else if (command === PluginCommand.CreateNewFile) {
      logger.debug(PluginCommand.CreateNewFile, msg);
      const document = await vscode.workspace.openTextDocument({
        language: getLanguageForFileExtension(msg.lang),
        content: msg.content,
      });
      await vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.One,
      });
      trackCodeAction('NEW_FILE', msg.messageId, msg.content, msg.language);
      return;
    }
    if (command === PluginCommand.ExplainCode) {
      this.starConversationOf(DevPilotFunctionality.ExplainCode, msg);
    } else if (command === PluginCommand.FixCode) {
      this.starConversationOf(DevPilotFunctionality.FixCode, msg);
    } else if (command === PluginCommand.CommentCode) {
      this.starConversationOf(DevPilotFunctionality.CommentCode, msg);
    } else if (command === PluginCommand.TestCode) {
      this.starConversationOf(DevPilotFunctionality.GenerateTest, msg);
    } else if (command === PluginCommand.CheckCodePerformance) {
      this.starConversationOf(DevPilotFunctionality.CheckPerformance, msg);
    } else if (command === PluginCommand.ShowMessage) {
      const button = l10n.t('dismiss');
      if (msg.type === 'info') {
        vscode.window.showInformationMessage(msg.content, button);
      } else if (msg.type === 'error') {
        vscode.window.showErrorMessage(msg.content, button);
      } else if (msg.type === 'warning') {
        vscode.window.showWarningMessage(msg.content, button);
      }
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(join(this.extensionUri.fsPath, 'dist', 'index.html'))],
    };
    this.getHtmlForWebview().then((html) => {
      webviewView.webview.html = html;
      webviewView.webview.onDidReceiveMessage(this.handleCommandFromWebview.bind(this));
    });
  }

  private async getHtmlForWebview(): Promise<string> {
    const htmlPath = vscode.Uri.file(join(this.extensionUri.fsPath, 'dist', 'index.html'));
    let htmlContent = await fs.promises.readFile(htmlPath.fsPath, 'utf8');
    const configJSON = JSON.stringify({
      theme: getIdeTheme(),
      locale: this.config.locale(),
      env: process.env.NODE_ENV === 'development' ? 'test' : 'prd',
      version: getCurrentPluginVersion(),
      platform: 'vscode',
      loggedIn: globalState.get('TOKEN') ? true : false,
      username: globalState.get('USER_NAME') || 'User',
    });
    return htmlContent.replace('{"DEVPILOT_CONFIG":1}', JSON.stringify(configJSON).replace(/^"(.*)"$/, '$1'));
  }
}
