import { EventEmitter } from 'vscode';

const eventsProvider = {
  onFetchCompletion: new EventEmitter<'START' | 'END'>(),
  onLogin: new EventEmitter<0 | 1>(),
  configChange: new EventEmitter<{
    key: 'language' | 'localRAG';
    data?: any;
  }>(),
};

export default eventsProvider;
