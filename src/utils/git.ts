// import simpleGit from 'simple-git';
import vscode from 'vscode';
import { exec } from 'child_process';
// import { getWorkspaceRoot } from './vscode-extend';
import fs from 'fs';
import path from 'path';
import ini from 'ini';

export function getGitRemoteUrl(projectPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitConfigPath = path.join(projectPath, '.git', 'config');
    fs.readFile(gitConfigPath, 'utf8', (err, data) => {
      if (err) {
        reject(new Error(`can not read Git config file: ${err.message}`));
        return;
      }
      try {
        const config = ini.parse(data);
        const remoteOrigin = config['remote "origin"'];
        if (remoteOrigin && remoteOrigin.url) {
          resolve(remoteOrigin.url);
        } else {
          reject(new Error('git remote url not found'));
        }
      } catch (e: any) {
        reject(new Error(`parse Git config file failed: ${e?.message}`));
      }
    });
  });
}

// export async function getRepositoryName() {
//   const rootPath = getWorkspaceRoot();
//   if (!rootPath) {
//     return '';
//   }

//   try {
//     const git = simpleGit(rootPath);
//     const remotes = await git.getRemotes(true);

//     const origin = remotes.find((remote) => remote.name === 'origin');
//     if (origin) {
//       const url = origin.refs.fetch;
//       const repoName =
//         url
//           ?.split('/')
//           .pop()
//           ?.replace(/\.git$/, '') ?? '';
//       return repoName;
//     } else {
//       console.log('未找到 origin 远程仓库！');
//       return '';
//     }
//   } catch (error) {
//     console.error('获取 Git 仓库信息时出错：', error);
//     return '';
//   }
// }

export function getStagedDiff() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const repoPath = workspaceFolders![0].uri.fsPath;
  return new Promise<string>((resolve, reject) => {
    exec('git diff --cached', { cwd: repoPath }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout); // stdout is the output
      }
    });
  });
}
