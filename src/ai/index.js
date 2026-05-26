import { config } from '../config.js';
import * as mock from './mock.js';
import * as openai from './openai.js';

export async function complete(messages) {
  if (config.aiProvider === 'openai') {
    return openai.complete(messages);
  }
  return mock.complete(messages);
}
