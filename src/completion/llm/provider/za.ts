import { logger } from '@/utils/logger';
import { readJSONStream, StreamHandler } from '@/utils/stream';
import { ChatMessage, CodeReference, LLMChatHandler, LLMProvider, MessageRole, ProviderType } from '../../../typing';
import request, { ZAPI } from '@/utils/request';
import { configuration } from '@/configuration';
import { PARAM_BASE64_ON } from '@/env';
import { IChatParam, IMessageData } from '@/services/types';
import { encodeRequestBody } from '@/utils/encode';
import { wrapCodeRefInCodeblock } from '@/utils';
import { CHAT_API_VERSION } from '@/services/chat';

function removeDuplications(codeRefs?: CodeReference[]) {
  if (codeRefs?.length) {
    return codeRefs.filter((item) => codeRefs.find((item2) => !item2.sourceCode.includes(item.sourceCode)));
  }
  return codeRefs;
}

function convertToMessagesData(messages: ChatMessage[]): IMessageData[] {
  const validRoles: MessageRole[] = ['user', 'assistant'];
  const clonedMessages = messages
    .filter((msg) => {
      // if (msg.role === 'assistant') {
      //   return msg.content; // 这个地方不能按照content过滤，因为带recall的就为空
      // }
      return validRoles.includes(msg.role);
    })
    .map((item) => {
      return { ...item };
    });

  clonedMessages.forEach((item, index) => {
    if (item.recall) {
      if (index > 0) {
        clonedMessages[index - 1].recall = item.recall;
      }
      item.recall = undefined;
    }
  });

  const answerLanguage = configuration().gLocale();
  return clonedMessages
    .filter((item) => item.content)
    .map((msg) => {
      const { codeRefs, recall } = msg;
      const localRefs = recall?.localRefs;
      const remoteRefs = recall?.remoteRefs;
      let promptData: IMessageData['promptData'] | undefined;
      if (msg.role === 'user') {
        promptData = {
          // selectedCode: wrapCodeRefInCodeblock(codeRef),
          answerLanguage,
          language: 'javascript',
          relatedContext: removeDuplications(localRefs)
            ?.map((ref, index) => {
              const codeBlock = wrapCodeRefInCodeblock(ref);
              const indexStr = `${index + 1}. `;
              if (ref.packageName) {
                return `\n\n${indexStr}local module '${ref.packageName}'\n${codeBlock}`;
              }
              return `\n\n${indexStr}\n${codeBlock}`;
            })
            .join(''),
          additionalRelatedContext: remoteRefs
            ?.map((ref, index) => {
              const codeBlock = wrapCodeRefInCodeblock(ref);
              const indexStr = `${index + 1}. `;
              return `\n\n${indexStr}from codebase: ${ref.fileUrl}\n${codeBlock}`;
            })
            .join(''),
        };
        if (codeRefs?.length) {
          promptData.refs = JSON.stringify(
            codeRefs.map((item) => {
              return { selectedCode: wrapCodeRefInCodeblock(item), filePath: item.filePath };
            })
          );
        }
      }

      return {
        commandType: msg.commandType,
        content: msg.content,
        role: msg.role,
        promptData,
      };
    });
}

export default class ZAProvider implements LLMProvider {
  public name: ProviderType = 'ZA';
  // private stream: boolean = true;

  async chat(messages: ChatMessage[], extraOptions?: { signal?: AbortSignal }): Promise<LLMChatHandler> {
    try {
      const llmMsgs = convertToMessagesData(messages);
      const apiEndpoint = ZAPI('chatV2');
      logger.debug('llmMsgs', llmMsgs, 'extraOptions', extraOptions, 'apiEndpoint', apiEndpoint);
      const req = request({ timeout: 0 });

      let param: IChatParam | string = {
        version: CHAT_API_VERSION,
        stream: true,
        messages: llmMsgs,
      };

      logger.debug('chat param raw', JSON.stringify(param));

      if (PARAM_BASE64_ON) {
        param = await encodeRequestBody(param);
        // logger.debug('chat param', JSON.stringify(param));
      }

      const response = await req
        .post(apiEndpoint, param, {
          responseType: 'stream',
          timeout: 60 * 1000,
          signal: extraOptions?.signal,
        })
        .catch((err) => {
          if (err.code !== 'ERR_CANCELED') {
            throw err;
          }
        });

      let textCollected = '';
      let onTextCallback: (text: string, options: { id: string }) => void;
      let onInterruptedCallback: () => void;
      let streamHandler: StreamHandler | null = null;
      let streamDoneResolve: (value: string) => void;

      const ctrl: LLMChatHandler = {
        onText: (callback) => {
          onTextCallback = callback;
        },
        onInterrupted: (callback) => {
          onInterruptedCallback = callback;
        },
        result: async () => {
          return new Promise((resolve, reject) => {
            streamDoneResolve = resolve;
          });
        },
        interrupt: () => {
          streamHandler?.interrupt?.();
        },
      };

      streamHandler = {
        onProgress: (data: any) => {
          if (data.choices) {
            const text = data.choices[0]?.delta.content ?? '';
            textCollected += text;
            onTextCallback?.(textCollected, { id: data.id });
          }
          // else if (data.rag) {
          //   let text = `\n\n<div class="rag-files" data-repo="${repo}">`;
          //   data.rag.files.forEach(({ file }: any) => {
          //     text += `<div>${file}</div>`;
          //   });
          //   text += `</div>\n\n`;
          //   textCollected += text;
          //   onTextCallback?.(textCollected, { id: data.id });
          // }
        },
        onInterrupted: () => {
          onInterruptedCallback?.();
        },
        onDone: () => {
          logger.info('textCollected =>', textCollected);
          streamDoneResolve(textCollected);
        },
      };

      if (response) {
        readJSONStream(response.data, streamHandler);
      }

      return ctrl;
    } catch (error: any) {
      logger.error('Error when chat with ZA provider', error);
      if (error.message.startsWith('timeout')) {
        throw new Error('ZA request timeout');
      }
      if (error.response) {
        console.error(error.response);
        throw new Error(`ZA request failed with ${error.response.status}`);
      }
      if (error.code || error.message) {
        throw new Error(`ZA request failed: ${error.code || error.message}`);
      }
      throw new Error(`ZA request failed`);
    }
  }
}
