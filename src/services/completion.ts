import { removeUnexpectedContent } from '@/utils';
import { logger } from '@/utils/logger';
import { flowProcess } from './chat';
import { invokeLocalAgent } from './rag';

// /**
//  * Get autocompletion
//  */
// export async function getCompletions(
//   data: {
//     document: string;
//     filePath: string;
//     language: string;
//     position: number;
//     completionType: 'inline' | 'comment';
//     encoding?: 'base64';
//   },
//   signal?: AbortSignal
// ) {
//   if (PARAM_BASE64_ON) {
//     data.document = toBase64(data.document);
//     data.encoding = 'base64';
//   }
//   logger.info('req param', data);
//   return request().post(ZAPI('completion'), data, { timeout: 5000, signal });
// }

export interface AdditionalContextItem {
  scode: number;
  /**
   * absolute path
   */
  filePath: string;
  code: string;
}

export async function getCompletionsV2(
  data: {
    document: string;
    filePath: string;
    language: string;
    position: number;
    completionType: 'inline' | 'comment';
    additionalContext: AdditionalContextItem[];
  },
  signal?: AbortSignal
) {
  return invokeLocalAgent<{ id: string; content: string }>('/instruct-completion', {
    method: 'POST',
    data,
    signal,
  }).catch((err) => {
    logger.error(err);
  });
}

interface PredictParam {
  filePath: string; // src/xxxx
  document: string; // whole file text
  position: number; //cursor postion
}

export async function predict({ data, signal }: { data: PredictParam; signal?: AbortSignal }) {
  return flowProcess({ ...data, language: 'javascript' }, 'completionPrediction', { signal })
    .then((res) => {
      const content = res.data?.choices?.[0].message?.content as string;
      return removeUnexpectedContent(content);
    })
    .catch((err) => {
      console.error(err);
    });
}
