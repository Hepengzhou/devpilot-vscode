import path, { basename } from 'path';
import ignore from 'ignore';
import Parser from 'web-tree-sitter';
import fs from 'fs';
import SyntaxService from './syntax';
import { logger } from '@/utils/logger';
import { md5 } from '@/utils/md5';
import { getFileLanguageId } from '@/utils/mapping';

const TYPE_DECLARATIONS = ['enum_declaration', 'type_alias_declaration', 'interface_declaration'];
const FUNCTION_TYPES = ['arrow_function', 'function_expression'];
const MAX_LINES_COUNT = 2000;

export const MAX_FOLDER_COUNT = 100;
export const IGNORED_FOLDERS = ['node_modules', 'dist', '__tests__', '.umi'];

// 项目路径 hash/文件路径

export interface IBlockMeta {
  astType: string;
  startPosition: Parser.Point;
  endPosition: Parser.Point;
  startIndex: number;
  endIndex: number;
  code: string;
  comment?: string;
  codeVectors?: {
    commentsVector?: number[];
    llmSummaryVector?: number[];
    // codeChunkEmbeddedResponds: {
    //   startIndex: number;
    //   endIndex: number;
    //   codeChunkVector: number[];
    // }[];
  };
  llmSummary?: string;
  // function signature
  signature?: string;
  arguments?: string;
  returnType?: string;
  // class members
  fields?: IBlockMeta[];
  methods?: IBlockMeta[];
}

export interface IFileMata {
  filePath: string;
  fileName: string;
  hash: string;
  languageId: string;
  imports: string;
  // variable/enums/type/interface;
  fields: IBlockMeta[];
  functions: IBlockMeta[];
  expressions: IBlockMeta[];
  classes: IBlockMeta[];
}

export interface IVectorIndex {
  id: string;
  filePath: string;
  fileName: string;
  startIndex: number;
  endIndex: number;
  fileHash: string;
  code: string;
  codeVector: number[];
  comments?: string;
  commentsVector?: number[];
  llmSummary?: string;
  llmSummaryVector?: number[];
  timestamp: string;
}

export function isBuildBundle(code: string): boolean {
  if (/\/\/#\s*sourceMappingURL=.+.js.map/.test(code)) {
    return true;
  }
  // 移除单行注释
  code = code.replace(/\/\/.*$/gm, '');
  // 移除多行注释
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  const patterns = [
    /__webpack_require__/,
    /\.webpackChunk_/,
    /window\["webpackJsonp"\]/,
    /window.webpackJsonp/,
    /Object.defineProperty(exports, '__esModule', { value: true });/,
  ];
  return patterns.some((pattern) => pattern.test(code));
}

export function isMinified(code: string): boolean {
  const lines = code.split(/\r|\n/g).filter((item) => item.trim().length);
  if (lines.length <= 1 || lines.length > MAX_LINES_COUNT) {
    return true;
  }

  if (lines.some((line) => line.length > 500)) {
    return true;
  }

  // check if has a lot of short vars;
  const shortVarPattern = /\b[a-z]{1,2}\b/gi;
  const shortVarMatches = (code.match(shortVarPattern) || []).length;
  if (shortVarMatches / code.length > 0.05) {
    return true;
  }

  // only contain few whitespace
  const spaceRatio = (code.match(/\s/g) || []).length / code.length;
  if (spaceRatio < 0.1) {
    return true;
  }

  return false;
}

function getNodeComments(node: Parser.SyntaxNode): [Parser.SyntaxNode, string] | undefined {
  const results: Parser.SyntaxNode[] = [];
  while (node.previousSibling?.type === 'comment') {
    results.unshift(node.previousSibling);
    node = node.previousSibling;
  }
  return results.length ? [results[0], results.map((item) => item.text).join('\n')] : undefined;
}

function getImportsMeta(nodes: Parser.SyntaxNode[]) {
  const imports = nodes.filter((item) => item.type === 'import_statement');
  return imports.map((item) => item.text).join('\n');
}

function getFunctionMeta(node: Parser.SyntaxNode, fnNode: Parser.SyntaxNode): IBlockMeta {
  const parameters = fnNode.childForFieldName('parameters');
  const returnType = fnNode.childForFieldName('return_type');
  const [startNode, comment] = getNodeComments(node) || [];
  return {
    startPosition: startNode ? startNode.startPosition : node.startPosition, // count the comment
    endPosition: node.endPosition,
    startIndex: startNode ? startNode.startIndex : node.startIndex,
    endIndex: node.endIndex,
    code: node.text,
    comment,
    // exclude "()": empty parameter
    arguments: parameters && parameters.children.length > 2 ? parameters.text : undefined,
    returnType: returnType?.text.replace(/^:\s*/, ''),
    astType: fnNode.type,
  };
}

function getExpressionMeta(node: Parser.SyntaxNode, expNode: Parser.SyntaxNode): IBlockMeta {
  const [startNode, comment] = getNodeComments(node) || [];
  return {
    startPosition: startNode ? startNode.startPosition : node.startPosition,
    endPosition: node.endPosition,
    startIndex: startNode ? startNode.startIndex : node.startIndex,
    endIndex: node.endIndex,
    code: node.text,
    comment,
    astType: expNode.type,
  };
}

function getClassMeta(node: Parser.SyntaxNode, bodyNode: Parser.SyntaxNode): IBlockMeta {
  const fields: IBlockMeta[] = [];
  const methods: IBlockMeta[] = [];

  for (const member of bodyNode.children) {
    if (member.type.endsWith('_field_definition')) {
      const valueNode = member.childForFieldName('value');
      if (valueNode && FUNCTION_TYPES.includes(valueNode.type)) {
        // a = (e: any) => void
        // b = function() => {}
        // c() {}
        const fnMeta = getFunctionMeta(member, valueNode);
        methods.push(fnMeta);
      } else {
        // a = 1;
        // b = {};
        // c = a; // reference to another identifier
        const meta = getExpressionMeta(member, member);
        fields.push(meta);
      }
      const expMeta = getExpressionMeta(member, member);
      fields.push(expMeta);
    } else if (member.type === 'method_definition') {
      const fnMeta = getFunctionMeta(member, member);
      methods.push(fnMeta);
    }
  }

  const [startNode, comment] = getNodeComments(node) || [];
  return {
    startPosition: startNode ? startNode.startPosition : node.startPosition,
    endPosition: node.endPosition,
    startIndex: startNode ? startNode.startIndex : node.startIndex,
    endIndex: node.endIndex,
    code: node.text,
    comment,
    astType: node.type,
    fields,
    methods,
  };
}

function getFileMeta(rootNode: Parser.SyntaxNode) {
  const nodes = rootNode.children;

  const imports = getImportsMeta(nodes);
  const fields: IBlockMeta[] = [];
  const functions: IBlockMeta[] = [];
  const classes: IBlockMeta[] = [];
  const expressions: IBlockMeta[] = [];

  const process = (node: Parser.SyntaxNode, pNode: Parser.SyntaxNode) => {
    if (node.type === 'lexical_declaration') {
      // const xx = ...
      const declarator = node.children.find((item) => item.type === 'variable_declarator');
      const valueNode = declarator?.childForFieldName('value');
      if (valueNode && FUNCTION_TYPES.includes(valueNode.type)) {
        // const x = () => {}
        // const x = function() => {}
        const fnMeta = getFunctionMeta(pNode, valueNode);
        functions.push(fnMeta);
      } else {
        // const a = 1;
        // const b = {};
        // const c = a; // reference to another identifier
        const meta = getExpressionMeta(pNode, node);
        fields.push(meta);
      }
    } else if (TYPE_DECLARATIONS.includes(node.type)) {
      // type ProviderType = 'OpenAI' | 'Azure' | 'ZA' | Locale;
      // enum Locale = { Chinese = 'cn', English = 'en' }
      // interface CodeReference {}
      const meta = getExpressionMeta(pNode, node);
      fields.push(meta);
    } else if (node.type === 'function_declaration') {
      // function XXX() {}
      const fnMeta = getFunctionMeta(pNode, node);
      functions.push(fnMeta);
    } else if (node.type === 'class_declaration') {
      // class TestClass {}
      const body = node.childForFieldName('body');
      if (body) {
        const classMeta = getClassMeta(pNode, body);
        classes.push(classMeta);
      }
    } else if (node.type === 'expression_statement') {
      // getProjectIndexInfo(ig, root, '');
      const expMeta = getExpressionMeta(pNode, node);
      expressions.push(expMeta);
    }
  };

  for (const node of nodes) {
    if (node.type === 'export_statement') {
      const declaration = node.childForFieldName('declaration');
      declaration && process(declaration, node);
    } else {
      process(node, node);
    }
  }

  return {
    imports,
    fields,
    functions,
    classes,
    expressions,
  };
}

export async function buildFileMeta(fsPath: string): Promise<IFileMata | undefined> {
  const targetLangId = getFileLanguageId(fsPath);
  try {
    const targetDocText = fs.readFileSync(fsPath, 'utf8');
    if (isBuildBundle(targetDocText)) {
      logger.info('ignored: isBuildBundle', fsPath);
      return;
    }

    if (isMinified(targetDocText)) {
      logger.info('ignored: isMinified', fsPath);
      return;
    }

    const targetAstTree = await SyntaxService.instance.parse(targetDocText, targetLangId);
    if (targetAstTree) {
      const fileMeta = getFileMeta(targetAstTree.rootNode);
      return {
        filePath: fsPath,
        fileName: basename(fsPath),
        hash: md5(targetDocText),
        languageId: targetLangId,
        ...fileMeta,
      };
    }
  } catch (error) {
    console.error(error);
  }
}

export function getIgnore(projRoot: string) {
  const filePath = path.join(projRoot, '.gitignore');
  const filePath2 = path.join(projRoot, '.devpilotignore');

  const ig = ignore();
  let content = '';
  if (fs.existsSync(filePath)) {
    content += fs.readFileSync(filePath, { encoding: 'utf-8' });
  }
  if (fs.existsSync(filePath2)) {
    content += '\n' + fs.readFileSync(filePath2, { encoding: 'utf-8' });
  }
  if (content) {
    ig.add(content);
  }
  return ig;
}
