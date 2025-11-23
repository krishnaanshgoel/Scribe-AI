/**
 * Free audio transcription using browser's Web Speech API
 * Completely free - no API keys, no external services required
 * Works in Chrome, Edge, Safari (with limitations)
 */

interface TranscriptionOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

/**
 * Transcribe audio using browser's Web Speech API (FREE - no API keys needed)
 * Note: This works in the browser, not on the server
 * For server-side, we'll use a fallback approach
 * 
 * @param audioData - Audio buffer (WebM format) - not used for Web Speech API
 * @param options - Transcription options
 */
export async function transcribeAudio(
  audioData: Buffer,
  options: TranscriptionOptions = {}
): Promise<string> {
  // Web Speech API works in browser only
  // For server-side, we'll return a message indicating browser transcription is needed
  console.warn("Web Speech API transcription must be done in the browser. Returning placeholder.");
  
  return "[Audio transcription will be done in the browser using Web Speech API. This is a server-side placeholder.]";
}

/**
 * Transcribe audio chunk with streaming support
 * Note: Web Speech API transcription happens in browser, not server
 */
export async function transcribeAudioStream(
  audioChunk: Buffer,
  sessionId: string,
  chunkIndex: number
): Promise<string> {
  // This is a placeholder - actual transcription happens in browser
  return "[Browser-based transcription placeholder]";
}
