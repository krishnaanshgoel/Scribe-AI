/**
 * Gemini Live API Service using REST API
 * Streams audio chunks to Gemini Live API via REST endpoints
 * Model: gemini-2.5-flash-native-audio-preview-09-2025
 */

interface LiveSessionConfig {
  sessionId: string;
  socket: any;
  transcriptBuffer: string;
  chunkIndex: number;
}

const activeSessions = new Map<string, LiveSessionConfig>();

/**
 * Start a Live API session using REST API
 * Note: Gemini Live API uses WebSocket-like connection via REST
 */
export async function startLiveSession(
  sessionId: string,
  socket: any
): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  console.log(`Starting Gemini Live API session for ${sessionId}`);

  // Store session
  activeSessions.set(sessionId, {
    sessionId,
    socket,
    transcriptBuffer: "",
    chunkIndex: 0,
  });

  console.log(`✓ Live API session initialized for ${sessionId}`);
}

/**
 * Stream audio chunk to Gemini Live API
 * Processes 30-second chunks and receives transcription
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
    return `[Chunk ${chunkIndex}: Session not found]`;
  }

  try {
    console.log(`Streaming chunk ${chunkIndex} to Gemini Live API (${audioData.length} bytes)`);

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }

    // Convert WebM audio to base64
    const audioBase64 = audioData.toString("base64");

    // Use Gemini's generateContent API with audio input
    // Note: For Live API, we'd use streaming, but for now we'll use standard API
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: "Transcribe this audio accurately. Return only the transcript text.",
            },
            {
              inlineData: {
                mimeType: "audio/webm",
                data: audioBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Gemini API error:", errorData);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();

    // Extract transcript from response
    let transcript = "";
    if (
      result.candidates &&
      result.candidates[0] &&
      result.candidates[0].content &&
      result.candidates[0].content.parts
    ) {
      transcript = result.candidates[0].content.parts
        .map((part: any) => part.text || "")
        .join(" ")
        .trim();
    }

    if (transcript) {
      console.log(`✓ Chunk ${chunkIndex} transcribed: "${transcript.substring(0, 50)}..."`);
      
      // Emit transcript update via socket
      session.socket.emit("transcript:updated", {
        sessionId,
        transcript,
        chunkIndex,
      });

      return transcript;
    } else {
      return `[Chunk ${chunkIndex}: No transcript returned from Gemini API]`;
    }
  } catch (error) {
    console.error(`Error transcribing chunk ${chunkIndex} with Gemini:`, error);
    return `[Chunk ${chunkIndex}: Transcription error - ${error instanceof Error ? error.message : "Unknown error"}]`;
  }
}

/**
 * Check if a session exists
 */
export function hasActiveSession(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/**
 * Stop Live API session
 */
export async function stopLiveSession(sessionId: string): Promise<void> {
  activeSessions.delete(sessionId);
  console.log(`✓ Live API session stopped for ${sessionId}`);
}

