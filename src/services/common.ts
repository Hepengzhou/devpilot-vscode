import vscode from 'vscode';
import { OFFICIAL_SITE } from '@/env';
import globalState from './globalState';
import { CodeReference } from '@/typing';
import { FE_FILE_LANGS } from '@/utils/consts';

export const openOfficialSite = (path: string) => {
  const loginInfo = globalState.loginInfo;
  let url = OFFICIAL_SITE + path;
  if (loginInfo.token && loginInfo.userId && loginInfo.authType) {
    url +=
      '?token=' +
      encodeURIComponent(
        btoa(`token=${loginInfo.token}&userId=${loginInfo.userId}&authType=${loginInfo.authType}&timestamp=${Date.now()}`)
      );
  }
  vscode.env.openExternal(vscode.Uri.parse(url));
};

export function findPredictableCodeRefs(codeRefs?: CodeReference[]) {
  if (!codeRefs?.length) {
    return [];
  }
  return codeRefs.filter((codeRef) => FE_FILE_LANGS.includes(codeRef.languageId) && !/^[a-z0-9_$]+$/i.test(codeRef.sourceCode));
}
