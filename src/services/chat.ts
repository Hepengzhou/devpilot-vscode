import { getStagedDiff } from '@/utils/git';
import { logger } from '@/utils/logger';
import { getApiBase, requestV2, ZAPI } from '@/utils/request';
import { notifyLogin } from './login';
import { PARAM_BASE64_ON } from '@/env';
import { ChatMessage, DevPilotFunctionality } from '@/typing';
import { configuration } from '@/configuration';
import { removeUnexpectedContent, wrapCodeRefInCodeblock } from '@/utils';
import type { IChatParam, IMessageData } from './types';
import { encodeRequestBody } from '@/utils/encode';
import { type AxiosRequestConfig } from 'axios';

export const NO_STAGED_FILES = 'no staged files';
export const CHAT_API_VERSION = 'V250102';

export async function chat(data: Partial<IChatParam>, options?: AxiosRequestConfig<any>) {
  let param: Partial<IChatParam> | string = {
    version: CHAT_API_VERSION,
    stream: false,
    ...data,
  };

  logger.info('chat param =>', JSON.stringify(param));
  if (PARAM_BASE64_ON) {
    param = await encodeRequestBody(param);
  }
  // console.log('=====', param);

  return requestV2.post(ZAPI('chatV2'), param, options);
}

export async function generateCommitMsg(options: { signal?: AbortSignal }) {
  const diffStr = await getStagedDiff().catch((error) => {
    logger.error(error);
  });
  if (!diffStr) return Promise.resolve(NO_STAGED_FILES);

  return chat(
    {
      stream: false,
      messages: [
        {
          role: 'user',
          commandType: DevPilotFunctionality.GenerateCommit,
          promptData: {
            diff: diffStr,
            locale: configuration().gLocale(),
          },
        },
      ],
    },
    { signal: options?.signal }
  )
    .then((res) => res.data?.choices?.[0]?.message?.content)
    .catch((err) => {
      if (err?.response?.status == 401) {
        notifyLogin();
      }
      return Promise.reject(err);
    });
}

export async function predictV2({ message, signal }: { message: ChatMessage; signal?: AbortSignal }) {
  let promptData: IMessageData['promptData'] | undefined;
  if (message.codeRefs?.length) {
    promptData = {
      commandTypeFor: message.commandType,
      language: 'javascript',
    };
    // if (message.codeRefs.length === 1) {
    //   promptData.selectedCode = wrapCodeRefInCodeblock(message.codeRefs[0]);
    // } else {
    promptData.refs = JSON.stringify(
      message.codeRefs.map((item) => {
        return {
          selectedCode: wrapCodeRefInCodeblock(item),
        };
      })
    );
    // }
  }

  const messages: IMessageData[] = [
    {
      role: 'user',
      commandType: DevPilotFunctionality.CodePrediction,
      promptData,
      content: message.content || undefined,
    },
  ];

  return chat({ messages }, { signal, timeout: 5000 })
    .then((res) => {
      let content = res.data?.choices?.[0].message?.content as string;
      return removeUnexpectedContent(content);
    })
    .catch((err) => {
      console.error(err);
    });
}

interface ApiProcessOptions {
  isStreamMode?: boolean;
  signal?: AbortSignal;
}

export async function flowProcess(data: any, command: 'completionPrediction', options?: ApiProcessOptions) {
  let param: any = data;
  if (PARAM_BASE64_ON) {
    param = await encodeRequestBody(data);
  }

  logger.debug('flowProcess param', param);

  return requestV2.post(`${getApiBase()}/v2/flow/process`, param, {
    headers: {
      'X-DevPilot-Params': JSON.stringify({ command, isStreamMode: options?.isStreamMode }),
    },
    signal: options?.signal,
    responseType: options?.isStreamMode ? 'stream' : undefined,
  });
}
