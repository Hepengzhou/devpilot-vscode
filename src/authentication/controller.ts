import vscode, { Disposable, ExtensionContext } from 'vscode';
import { logger } from '@/utils/logger';
import { ILoginProvider } from './types';
import LoginProvider from './provider';
import eventsProvider from '@/providers/EventsProvider';
import l10n from '@/l10n';
import { checkingNetwork, stopCheckingNetwork } from '@/utils/network';
import { AUTH_ON } from '@/env';
import globalState from '@/services/globalState';

export default class LoginController extends Disposable {
  static instance: LoginController;
  static create(context: ExtensionContext) {
    if (!this.instance) {
      this.instance = new LoginController(context);
    }
    return this.instance;
  }

  private loginProvider: ILoginProvider | null;
  private context: ExtensionContext;

  constructor(context: ExtensionContext) {
    super(() => {
      this.onDestroy();
    });
    this.context = context;
    this.loginProvider = null;
    this.initialize();
  }

  initialize() {
    this.context.subscriptions.push(this);
    this.context.subscriptions.push(vscode.commands.registerCommand('devpilot.login', this.login));
    this.context.subscriptions.push(vscode.commands.registerCommand('devpilot.logout', this.logout));
    this.updateLoginStatus({ inform: true });
    logger.info('Login controller initialized!');
  }

  login = () => {
    if (!this.loginProvider) {
      this.loginProvider = new LoginProvider();
    }
    this.loginProvider.onLogin((e) => {
      logger.info('[Login]', 'Login success =>', e);
      const { loginType, userInfo } = e;
      const authType = { gzh: 'wx', za: 'za', zati: 'za_ti' }[loginType];
      globalState.set('LOGIN_TYPE', loginType);
      globalState.set('AUTH_TYPE', authType);
      globalState.set('USER_ID', userInfo.username || userInfo.openid);
      globalState.set('TOKEN', userInfo.token);
      globalState.set('USER_NAME', userInfo.username || userInfo.nickname);
      this.updateLoginStatus({ inform: true });
      eventsProvider.onLogin.fire(1);
    });
  };

  logout = () => {
    globalState.clearAll();
    vscode.commands.executeCommand('setContext', 'devpilot.login', 0);
    eventsProvider.onLogin.fire(0);
    stopCheckingNetwork();
    logger.info('Logout');
  };

  onLogin = (callback: () => void) => {
    return eventsProvider.onLogin.event(callback);
  };

  onDestroy() {
    this.loginProvider?.onDestroy();
    this.loginProvider = null;
  }

  updateLoginStatus({ inform }: { inform?: boolean }) {
    const { token, authType } = globalState.loginInfo;
    if (token || !AUTH_ON) {
      vscode.commands.executeCommand('setContext', 'devpilot.login', 1);
      checkingNetwork(authType!);
    } else {
      vscode.commands.executeCommand('setContext', 'devpilot.login', 0);
      if (inform) {
        setTimeout(() => {
          const buttons = [l10n.t('login'), l10n.t('dismiss')];
          vscode.window.showInformationMessage(l10n.t('msg.signin'), ...buttons).then((res) => {
            if (res === buttons[0]) {
              vscode.commands.executeCommand('devpilot.login');
            }
          });
        }, 5000);
      }
    }
  }
}
