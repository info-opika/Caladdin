import type { Request, Response } from 'express';

export type VoiceStreamStatusPhase = 'thinking' | 'streaming';

export interface VoiceStreamTokenEvent {
  text: string;
}

export interface VoiceStreamStatusEvent {
  phase: VoiceStreamStatusPhase;
}

export interface VoiceStreamDoneEvent {
  result: Record<string, unknown>;
}

export interface VoiceStreamErrorEvent {
  message: string;
  status?: number;
}

export function wantsVoiceStream(req: Request): boolean {
  if (req.body?.stream === true) return true;
  const accept = req.get('accept') ?? '';
  return accept.includes('text/event-stream');
}

export function initVoiceSseResponse(res: Response, requestId: string): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('x-request-id', requestId);
  res.flushHeaders();
}

export function writeVoiceSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function writeVoiceStreamStatus(res: Response, phase: VoiceStreamStatusPhase): void {
  writeVoiceSseEvent(res, 'status', { phase } satisfies VoiceStreamStatusEvent);
}

export function writeVoiceStreamToken(res: Response, text: string): void {
  if (!text) return;
  writeVoiceSseEvent(res, 'token', { text } satisfies VoiceStreamTokenEvent);
}

export function writeVoiceStreamDone(res: Response, result: Record<string, unknown>): void {
  writeVoiceSseEvent(res, 'done', { result } satisfies VoiceStreamDoneEvent);
}

export function writeVoiceStreamError(
  res: Response,
  message: string,
  status = 500,
): void {
  writeVoiceSseEvent(res, 'error', { message, status } satisfies VoiceStreamErrorEvent);
}

export function endVoiceSse(res: Response): void {
  res.end();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Split assistant text into streamable chunks (words + trailing space). */
export function chunkTextForStream(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (part) chunks.push(part);
  }
  return chunks;
}

export async function streamTextAsTokens(
  res: Response,
  text: string,
  options: { chunkDelayMs?: number } = {},
): Promise<void> {
  const delayMs = options.chunkDelayMs ?? 20;
  const chunks = chunkTextForStream(text);
  if (chunks.length === 0) return;

  writeVoiceStreamStatus(res, 'streaming');
  for (const chunk of chunks) {
    writeVoiceStreamToken(res, chunk);
    if (delayMs > 0) await sleep(delayMs);
  }
}

export async function deliverVoiceResultAsSse(
  res: Response,
  result: Record<string, unknown>,
  options: { chunkDelayMs?: number } = {},
): Promise<void> {
  const message =
    typeof result.messageToUser === 'string' && result.messageToUser.length > 0
      ? result.messageToUser
      : 'Done.';
  writeVoiceStreamStatus(res, 'thinking');
  await streamTextAsTokens(res, message, options);
  writeVoiceStreamDone(res, result);
  endVoiceSse(res);
}
