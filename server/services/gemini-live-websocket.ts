/**
 * Gemini Live API Service using WebSocket
 * Real-time audio streaming and transcription via WebSocket connection
 * Model: gemini-2.5-flash-native-audio-preview-09-2025
 */

import WebSocket from "ws";
import { EventEmitter } from "events";

interface LiveSessionConfig {
  sessionId: string;
  socket: any; // Socket.io socket for emitting updates
  geminiWs: WebSocket | null;
  transcriptBuffer: string;
  chunkIndex: number;
  isConnected: boolean;
  eventEmitter: EventEmitter;
}

const activeSessions = new Map<string, LiveSessionConfig>();

/**
 * Start a Gemini Live API WebSocket session
 */
export async function startLiveSession(
  sessionId: string,
  socket: any
): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  console.log(`Starting Gemini Live API WebSocket session for ${sessionId}`);

  // Create event emitter for this session
  const eventEmitter = new EventEmitter();

  // WebSocket URL for Gemini Live API
  // Using the Live API streaming endpoint
  // Format: wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

  // Create WebSocket connection
  const geminiWs = new WebSocket(wsUrl, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  const sessionConfig: LiveSessionConfig = {
    sessionId,
    socket,
    geminiWs,
    transcriptBuffer: "",
    chunkIndex: 0,
    isConnected: false,
    eventEmitter,
  };
  
  // Store session immediately (before connection is established)
  activeSessions.set(sessionId, sessionConfig);
  console.log(`[TAB MODE] Stored Gemini Live API session for ${sessionId} (total sessions: ${activeSessions.size})`);

  // Handle WebSocket connection open
  geminiWs.on("open", () => {
    console.log(`✓ Gemini Live API WebSocket connected for ${sessionId}`);
    sessionConfig.isConnected = true;

    // Send setup message to configure the session
    // Format based on Gemini Live API specification
    const setupMessage = {
      setup: {
        model: "models/gemini-2.5-flash-native-audio-preview-09-2025",
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseModalities: ["TEXT"], // We only need text transcript
        },
        inputAudioTranscription: {
          // Enable input audio transcription (empty object enables it)
        },
      },
    };

    try {
      geminiWs.send(JSON.stringify(setupMessage));
      console.log(`✓ Setup message sent for ${sessionId}`);
    } catch (error) {
      console.error(`Error sending setup message for ${sessionId}:`, error);
      sessionConfig.isConnected = false;
    }
  });

  // Handle incoming messages from Gemini Live API
  geminiWs.on("message", (data: WebSocket.Data) => {
    try {
      const messageStr = data.toString();
      const message = JSON.parse(messageStr);
      
      // Log all messages for debugging (first 200 chars)
      console.log(`[Gemini Live API] Message for ${sessionId}:`, JSON.stringify(message).substring(0, 200));
      
      // Handle setup response/acknowledgment
      if (message.setupComplete || message.serverContent?.setupComplete) {
        console.log(`✓ Setup complete for ${sessionId}`);
      }
      
      // Handle transcription responses
      // Check multiple possible response formats (camelCase and snake_case)
      const transcriptText = 
        message.serverContent?.inputTranscription?.text ||
        message.serverContent?.input_transcription?.text ||
        message.inputTranscription?.text ||
        message.input_transcription?.text ||
        message.serverContent?.text ||
        message.text;

      if (transcriptText) {
        const transcript = typeof transcriptText === "string" ? transcriptText : transcriptText.text || "";
        if (transcript.trim().length > 0) {
          console.log(`✓ Received transcript for ${sessionId}: "${transcript.substring(0, 100)}..."`);
          
          // Accumulate transcript for full session transcript
          sessionConfig.transcriptBuffer += (sessionConfig.transcriptBuffer ? " " : "") + transcript;
          
          // Emit ONLY the incremental transcript (not accumulated) via Socket.io
          // This way frontend shows only the new text, not accumulated
          socket.emit("transcript:updated", {
            sessionId,
            transcript: transcript, // Send only incremental text
            fullTranscript: sessionConfig.transcriptBuffer, // Also send full for reference
            chunkIndex: sessionConfig.chunkIndex,
            isIncremental: true,
          });

          // Emit event for internal handling (incremental only)
          sessionConfig.eventEmitter.emit("transcript", transcript);
        }
      }

      // Handle other server content
      if (message.serverContent?.modelTurn) {
        console.log(`Model turn received for ${sessionId}`);
      }

      // Handle errors
      if (message.error) {
        console.error(`Gemini Live API error for ${sessionId}:`, JSON.stringify(message.error));
        eventEmitter.emit("error", message.error);
      }
    } catch (error) {
      console.error(`Error parsing Gemini Live API message for ${sessionId}:`, error);
      console.error(`Raw message:`, data.toString().substring(0, 500));
    }
  });

  // Handle WebSocket errors
  geminiWs.on("error", (error) => {
    console.error(`Gemini Live API WebSocket error for ${sessionId}:`, error);
    sessionConfig.isConnected = false;
    eventEmitter.emit("error", error);
  });

  // Handle WebSocket close
  geminiWs.on("close", (code, reason) => {
    console.log(`Gemini Live API WebSocket closed for ${sessionId}: ${code} - ${reason}`);
    sessionConfig.isConnected = false;
    eventEmitter.emit("close", { code, reason });
  });

  // Store session
  activeSessions.set(sessionId, sessionConfig);
  console.log(`✓ Gemini Live API WebSocket session initialized for ${sessionId}`);
}

/**
 * Stream audio chunk to Gemini Live API via WebSocket
 * Processes 30-second chunks and receives real-time transcription
 */
export async function streamAudioChunk(
  sessionId: string,
  audioData: Buffer,
  chunkIndex: number,
  startTime: number,
  endTime: number
): Promise<string> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`[streamAudioChunk] No session found for ${sessionId}`);
    return `[Chunk ${chunkIndex}: Session not found]`;
  }

  if (!session.geminiWs) {
    console.warn(`[streamAudioChunk] No WebSocket for ${sessionId}`);
    return `[Chunk ${chunkIndex}: WebSocket not initialized]`;
  }

  if (session.geminiWs.readyState !== WebSocket.OPEN) {
    console.warn(`[streamAudioChunk] WebSocket not open for ${sessionId}, state: ${session.geminiWs.readyState}`);
    return `[Chunk ${chunkIndex}: WebSocket not connected (state: ${session.geminiWs.readyState})]`;
  }

  try {
    console.log(`[streamAudioChunk] Streaming chunk ${chunkIndex} to Gemini Live API via WebSocket (${audioData.length} bytes)`);

    // Convert audio buffer to base64
    const audioBase64 = audioData.toString("base64");

    // Send audio chunk via WebSocket
    // Format: { clientContent: { realtimeInput: { mediaChunks: [{ mimeType, data }] } } }
    // Note: Gemini Live API accepts audio/webm format
    const audioMessage = {
      clientContent: {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "audio/webm", // Gemini Live API accepts WebM format
              data: audioBase64,
            },
          ],
        },
      },
    };

    try {
      session.geminiWs.send(JSON.stringify(audioMessage));
      console.log(`✓ Audio chunk ${chunkIndex} sent to Gemini Live API`);
      session.chunkIndex = chunkIndex;
    } catch (sendError) {
      console.error(`Error sending audio chunk ${chunkIndex}:`, sendError);
      return `[Chunk ${chunkIndex}: Send error - ${sendError instanceof Error ? sendError.message : "Unknown"}]`;
    }

    // Wait for transcript (with longer timeout for 5-second chunks)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.eventEmitter.removeListener("transcript", transcriptHandler);
        console.warn(`[streamAudioChunk] Timeout waiting for transcript for chunk ${chunkIndex}`);
        resolve(`[Chunk ${chunkIndex}: Timeout waiting for transcript]`);
      }, 15000); // 15 second timeout (longer for processing)

      const transcriptHandler = (transcript: string) => {
        clearTimeout(timeout);
        session.eventEmitter.removeListener("transcript", transcriptHandler);
        console.log(`✓ Received transcript for chunk ${chunkIndex}: "${transcript.substring(0, 50)}..."`);
        resolve(transcript);
      };

      session.eventEmitter.once("transcript", transcriptHandler);
    });
  } catch (error) {
    console.error(`Error streaming chunk ${chunkIndex} to Gemini Live API:`, error);
    return `[Chunk ${chunkIndex}: Error - ${error instanceof Error ? error.message : "Unknown error"}]`;
  }
}

/**
 * Send turn complete signal to Gemini Live API
 */
export async function sendTurnComplete(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session || !session.geminiWs || !session.isConnected) {
    return;
  }

  try {
    const turnCompleteMessage = {
      clientContent: {
        turnComplete: true,
      },
    };

    session.geminiWs.send(JSON.stringify(turnCompleteMessage));
    console.log(`Turn complete sent for ${sessionId}`);
  } catch (error) {
    console.error(`Error sending turn complete for ${sessionId}:`, error);
  }
}

/**
 * Stop Gemini Live API WebSocket session
 */
export async function stopLiveSession(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return;
  }

  try {
    // Send turn complete before closing
    await sendTurnComplete(sessionId);

    // Close WebSocket connection
    if (session.geminiWs) {
      session.geminiWs.close();
      session.geminiWs = null;
    }

    // Clean up event emitter
    session.eventEmitter.removeAllListeners();

    // Remove session
    activeSessions.delete(sessionId);
    console.log(`✓ Gemini Live API WebSocket session stopped for ${sessionId}`);
  } catch (error) {
    console.error(`Error stopping Live API session for ${sessionId}:`, error);
    activeSessions.delete(sessionId);
  }
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}

/**
 * Check if a specific session has an active Gemini Live API WebSocket connection
 */
export function hasActiveSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  return session !== undefined && session.isConnected === true && session.geminiWs !== null;
}

/**
 * Get session transcript buffer
 */
export function getSessionTranscript(sessionId: string): string {
  const session = activeSessions.get(sessionId);
  return session?.transcriptBuffer || "";
}

