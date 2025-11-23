import { GoogleGenerativeAI } from "@google/generative-ai";

// Lazy initialization to allow .env to load first
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in environment variables. Please check your .env file.");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Transcribe audio chunk using Gemini API
 * @param audioData - Base64 encoded audio data or audio file buffer
 * @param options - Transcription options
 */
export async function transcribeAudio(
  audioData: Buffer | string,
  options: {
    language?: string;
    prompt?: string;
  } = {}
): Promise<string> {
  try {
    // Note: Gemini API doesn't directly support audio transcription via text API
    // For now, we'll return a placeholder message
    // In production, you would need to:
    // 1. Use Google Cloud Speech-to-Text API, or
    // 2. Use a third-party transcription service, or
    // 3. Convert audio to text using Whisper API or similar
    
    console.log("Audio transcription requested - returning placeholder");
    console.log("Audio data size:", typeof audioData === "string" ? audioData.length : audioData.length);
    
    // Return placeholder for now
    return `[Audio chunk transcription - Audio transcription service not yet configured. 
    To enable transcription, integrate Google Cloud Speech-to-Text API or another transcription service.]`;
    
    // Uncomment below when you have a proper transcription service:
    /*
    const model = getGenAI().getGenerativeModel({ model: "gemini-1.5-pro" });
    const prompt = options.prompt || 
      "Transcribe the following audio accurately. Include speaker diarization if multiple speakers are detected. Return only the transcript text.";
    const audioBase64 = typeof audioData === "string" 
      ? audioData 
      : audioData.toString("base64");
    const result = await model.generateContent([prompt]);
    const response = await result.response;
    return response.text();
    */
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw new Error("Failed to transcribe audio");
  }
}

/**
 * Generate summary from transcript using Gemini API
 * @param transcript - Full transcript text
 */
export async function generateSummary(transcript: string): Promise<string> {
  try {
    // Use gemini-1.5-pro or gemini-1.5-flash for better results
    const model = getGenAI().getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Summarize this meeting transcript. Include:
1. Key points discussed
2. Action items
3. Decisions made
4. Important deadlines or dates

Transcript:
${transcript}

Provide a concise summary:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error generating summary:", error);
    throw new Error("Failed to generate summary");
  }
}

/**
 * Transcribe audio chunk with streaming support
 * Note: This is a placeholder - actual streaming implementation depends on Gemini API capabilities
 */
export async function transcribeAudioStream(
  audioChunk: Buffer,
  sessionId: string,
  chunkIndex: number
): Promise<string> {
  // For now, use regular transcription
  // In production, you might want to use streaming API if available
  return transcribeAudio(audioChunk, {
    prompt: `Transcribe this audio chunk (chunk ${chunkIndex}) from session ${sessionId}. Be accurate and include speaker identification if multiple speakers are present.`,
  });
}

