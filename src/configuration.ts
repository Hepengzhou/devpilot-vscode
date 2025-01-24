import eventsProvider from '@/providers/EventsProvider';
import vscode from 'vscode';
import { ProviderType, LLMProvider, Locale, Language } from './typing';
import llmProvider from './completion/llm/provider';

const DEFAULT_PROVIDER: ProviderType = 'ZA';

function getDevPilotDefaultLocale(): Language {
  if (vscode.env.language.includes('zh')) {
    return 'Chinese';
  }
  return 'English';
}

export type Configuration = {
  locale: () => Locale;
  gLocale: () => 'zh_CN' | 'en_US';
  lang: () => Language;
  llm: () => LLMProvider;
  username: () => string | undefined;
  localRAG: () => string | undefined;
};

let globalConfiguration: Configuration;

export function configuration(context?: vscode.ExtensionContext) {
  if (globalConfiguration) return globalConfiguration;

  if (!context) {
    throw new Error('configurationManager needs context');
  }

  const config = vscode.workspace.getConfiguration('devpilot');
  if (!config.get('language')) {
    const vscodeLang = getDevPilotDefaultLocale();
    config.update('language', vscodeLang, vscode.ConfigurationTarget.Global);
  }

  const llm = llmProvider.get(DEFAULT_PROVIDER);
  vscode.workspace.onDidChangeConfiguration((event) => {
    const config = vscode.workspace.getConfiguration('devpilot');
    if (event.affectsConfiguration('devpilot.localRAG')) {
      const localRAG = config.get('localRAG');
      eventsProvider.configChange.fire({ key: 'localRAG', data: localRAG });
    } else if (event.affectsConfiguration('devpilot.language')) {
      eventsProvider.configChange.fire({ key: 'language' });
    }
  });

  globalConfiguration = {
    gLocale() {
      return this.lang() === 'Chinese' ? 'zh_CN' : 'en_US';
    },
    locale() {
      return this.lang() === 'Chinese' ? Locale.Chinese : Locale.English;
    },
    localRAG() {
      return vscode.workspace.getConfiguration('devpilot').get('localRAG');
    },
    llm: () => llm,
    lang: () => vscode.workspace.getConfiguration('devpilot').get('language') || 'Chinese',
    username: () => context.globalState.get<string>('USER_NAME'),
  };

  return globalConfiguration;
}
