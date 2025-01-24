import { v4 as uuid } from 'uuid';
import { ChatMessage } from '../typing';

export const createSystemMessage = (msg: Partial<ChatMessage>): ChatMessage => {
  return {
    id: uuid(),
    status: 'ok',
    content: msg.content ?? '',
    role: 'system',
    username: 'System',
    avatar: '',
    streaming: false,
    time: msg.time ?? Date.now(),
  };
};

export const createUserMessage = (msg: Partial<ChatMessage>): ChatMessage => {
  return {
    id: uuid(),
    status: 'ok',
    content: msg.content ?? '',
    // prompt: msg.prompt ?? '',
    codeRefs: msg.codeRefs,
    role: 'user',
    username: 'You',
    avatar: '',
    streaming: false,
    time: msg.time ?? Date.now(),
    commandType: msg.commandType,
  };
};

export const createAssistantMessage = (msg: Partial<ChatMessage>): ChatMessage => {
  return {
    id: uuid(),
    status: 'ok',
    content: msg.content ?? '',
    // prompt: msg.prompt ?? '',
    codeRefs: msg.codeRefs,
    role: 'assistant',
    username: 'DevPilot',
    avatar: '',
    streaming: msg.streaming ?? false,
    time: msg.time ?? Date.now(),
    recall: msg.recall,
  };
};

export const createDividerMessage = (): ChatMessage => {
  return {
    id: uuid(),
    status: 'ok',
    content: '',
    role: 'divider',
    username: '',
    avatar: '',
    streaming: false,
    time: Date.now(),
  };
};
