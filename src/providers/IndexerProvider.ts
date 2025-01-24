import eventsProvider from '@/providers/EventsProvider';
import { killLocalRagService } from '@/services/rag';
import { buildLocalIndexOfAllFiles, buildLocalIndexOfAllFilesWithProgress } from '@/services/vectorLocal';
import { logger } from '@/utils/logger';
import vscode, { ExtensionContext } from 'vscode';

const INTERVAL = 15 * 60 * 1000;

export default class IndexerProvider {
  private _context: vscode.ExtensionContext;
  private execTimer: NodeJS.Timeout | undefined;
  static instance: IndexerProvider;

  constructor(context: ExtensionContext) {
    this._context = context;
    IndexerProvider.instance = this;
    this.initialize();
  }

  initialize() {
    this._context.subscriptions.push(vscode.commands.registerCommand('devpilot.generateIndex', buildLocalIndexOfAllFilesWithProgress));
    this._context.subscriptions.push(this);
    const config = vscode.workspace.getConfiguration('devpilot');
    if (config.get('localRAG') ?? true) {
      this.startNextTick();
    }
    eventsProvider.configChange.event((e) => {
      if (e.key === 'localRAG') {
        if (e.data) {
          this.startNextTick(5000);
        } else {
          this.dispose();
        }
      }
    });
  }

  startNextTick(interval?: number) {
    this.dispose();
    logger.info('start indexer ticking ...');
    this.execTimer = setTimeout(() => this.exec(), interval || INTERVAL);
  }

  async exec() {
    await buildLocalIndexOfAllFiles();
    this.startNextTick();
  }

  dispose() {
    killLocalRagService();
    clearTimeout(this.execTimer);
  }
}
