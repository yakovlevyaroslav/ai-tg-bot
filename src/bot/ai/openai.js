import OpenAI from 'openai';
import { config } from '../../shared/config.js';

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
});

export async function complete(messages) {
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    messages,
    max_tokens: 8192,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return {
    content,
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
    },
    model: response.model ?? config.openaiModel,
  };
}
