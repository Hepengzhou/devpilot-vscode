import { extname } from 'path';

const extensionToLanguageMap: { [key: string]: string } = {
  '.bat': 'bat',
  '.c': 'c',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.cljc': 'clojure',
  '.coffee': 'coffeescript',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.styl': 'stylus',
  '.dockerfile': 'dockerfile',
  '.f': 'fortran',
  '.fs': 'fsharp',
  '.go': 'go',
  '.groovy': 'groovy',
  '.h': 'c',
  '.handlebars': 'handlebars',
  '.hbs': 'handlebars',
  '.html': 'html',
  '.htm': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascriptreact',
  '.kt': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.php': 'php',
  '.pl': 'perl',
  '.ps1': 'powershell',
  '.py': 'python',
  '.r': 'r',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scala': 'scala',
  '.sh': 'shellscript',
  '.sql': 'sql',
  '.swift': 'swift',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.vb': 'vb',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

export function getLanguageForFileExtension(extension: string): string {
  let lang = 'plaintext';
  if (extension) {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    lang = extensionToLanguageMap[ext.toLowerCase()] || lang;
  }
  return lang;
}

export function getFileLanguageId(fsPath: string) {
  return fsPath ? getLanguageForFileExtension(extname(fsPath)) : '';
}

export function getLanguageForMarkdown(langId: string) {
  const languageMap: { [key: string]: string } = {
    javascriptreact: 'jsx',
    typescriptreact: 'tsx',
  };

  return languageMap[langId] || langId;
}
