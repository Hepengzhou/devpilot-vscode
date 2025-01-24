import vscode from 'vscode';

let __context: vscode.ExtensionContext;

export type TGlobalStateKey = 'LOGIN_TYPE' | 'AUTH_TYPE' | 'USER_ID' | 'TOKEN' | 'USER_NAME' | 'rag-port' | 'lang';

export default {
  globalStoragePath: '',
  extensionPath: '',

  initialize(context: vscode.ExtensionContext) {
    __context = context;
    this.globalStoragePath = context.globalStorageUri.fsPath;
    this.extensionPath = context.extensionPath;
  },

  get<T = string>(key: TGlobalStateKey) {
    return __context.globalState.get<T>(key);
  },

  set(key: TGlobalStateKey, value: any) {
    return __context.globalState.update(key, value);
  },

  clearAll() {
    __context.globalState.keys().forEach((key) => {
      __context.globalState.update(key, null);
    });
  },

  get loginInfo() {
    return {
      authType: this.get<string>('AUTH_TYPE'),
      userId: this.get<string>('USER_ID'),
      token: this.get<string>('TOKEN'),
    };
  },
};
