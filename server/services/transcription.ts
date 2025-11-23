import { transcribeAudioStream } from "@/lib/transcription";
import { streamAudioChunk } from "./gemini-live-websocket";
import { prisma } from "@/lib/prisma";
import { TranscriptChunk } from "@/lib/types";

interface AudioChunk {
  sessionId: string;
  chunkIndex: number;
  audioData: Buffer;
  startTime: number;
  endTime: number;
}

/**
 * Process audio chunk and store transcript
 */
export async function processAudioChunk(chunk: AudioChunk): Promise<void> {
  try {
    console.log(`Processing chunk ${chunk.chunkIndex} for session ${chunk.sessionId} (size: ${chunk.audioData.length} bytes)`);

    // Transcribe audio using Gemini Live API (30-second chunks)
    // Note: Web Speech API transcripts are handled separately via transcript:chunk event
    // This function only processes audio chunks for Gemini Live API
    let finalTranscript: string;
    
    // Check if WebSocket session exists for THIS specific sessionId
    const { getActiveSessionCount, hasActiveSession } = await import("./gemini-live-websocket");
    const websocketSessionExists = hasActiveSession(chunk.sessionId);
    
    // Also check if REST API session exists
    let restSessionExists = false;
    try {
      const { hasActiveSession: hasActiveSessionREST } = await import("./gemini-live-rest");
      restSessionExists = hasActiveSessionREST(chunk.sessionId);
    } catch (e) {
      // REST API might not be available
    }
    
    const sessionExists = websocketSessionExists || restSessionExists;
    
    if (!sessionExists) {
      // If no WebSocket session, try REST API fallback
      console.log(`[TAB MODE] No active Gemini Live API WebSocket session for ${chunk.sessionId}. Trying REST API fallback...`);
      try {
        const { streamAudioChunk: streamAudioChunkREST } = await import("./gemini-live-rest");
        const transcribed = await streamAudioChunkREST(
          chunk.sessionId,
          chunk.audioData,
          chunk.chunkIndex,
          chunk.startTime,
          chunk.endTime
        );
        
        if (
          transcribed &&
          transcribed.trim().length > 0 &&
          !transcribed.includes("[Chunk") &&
          !transcribed.includes("Session not found") &&
          !transcribed.includes("Transcription error") &&
          !transcribed.includes("No transcript")
        ) {
          finalTranscript = transcribed;
          console.log(`✓ Chunk ${chunk.chunkIndex} transcribed successfully via Gemini REST API`);
        } else {
          console.warn(`[TAB MODE] REST API returned placeholder for chunk ${chunk.chunkIndex}`);
          return; // Don't create placeholder entries
        }
      } catch (restError) {
        console.error(`Error transcribing chunk ${chunk.chunkIndex} with Gemini REST API:`, restError);
        return; // Don't create placeholder entries
      }
    } else {
      console.log(`[TAB MODE] Processing audio chunk ${chunk.chunkIndex} for session ${chunk.sessionId} via Gemini Live API WebSocket`);
      try {
        // Use Gemini Live API WebSocket for real-time transcription
        const transcribed = await streamAudioChunk(
          chunk.sessionId,
          chunk.audioData,
          chunk.chunkIndex,
          chunk.startTime,
          chunk.endTime
        );
        
        // Use transcribed text if available and not a placeholder
        if (
          transcribed &&
          transcribed.trim().length > 0 &&
          !transcribed.includes("[Chunk") &&
          !transcribed.includes("Session not found") &&
          !transcribed.includes("Transcription error") &&
          !transcribed.includes("WebSocket not connected") &&
          !transcribed.includes("Timeout")
        ) {
          finalTranscript = transcribed;
          console.log(`✓ Chunk ${chunk.chunkIndex} transcribed successfully via Gemini Live API WebSocket`);
        } else {
          // Fallback to REST API if WebSocket returned placeholder/timeout
          console.log(`[TAB MODE] WebSocket returned placeholder for chunk ${chunk.chunkIndex}, trying REST API fallback...`);
          try {
            const { streamAudioChunk: streamAudioChunkREST } = await import("./gemini-live-rest");
            const restTranscribed = await streamAudioChunkREST(
              chunk.sessionId,
              chunk.audioData,
              chunk.chunkIndex,
              chunk.startTime,
              chunk.endTime
            );
            
            if (
              restTranscribed &&
              restTranscribed.trim().length > 0 &&
              !restTranscribed.includes("[Chunk") &&
              !restTranscribed.includes("No transcript")
            ) {
              finalTranscript = restTranscribed;
              console.log(`✓ Chunk ${chunk.chunkIndex} transcribed successfully via Gemini REST API (fallback)`);
            } else {
              console.warn(`[TAB MODE] Both WebSocket and REST API failed for chunk ${chunk.chunkIndex}`);
              return; // Don't create placeholder entries
            }
          } catch (restError) {
            console.error(`Error with REST API fallback for chunk ${chunk.chunkIndex}:`, restError);
            return; // Don't create placeholder entries
          }
        }
      } catch (error) {
        console.error(`Error transcribing chunk ${chunk.chunkIndex} with Gemini Live API WebSocket:`, error);
        // Try REST API fallback
        try {
          const { streamAudioChunk: streamAudioChunkREST } = await import("./gemini-live-rest");
          const restTranscribed = await streamAudioChunkREST(
            chunk.sessionId,
            chunk.audioData,
            chunk.chunkIndex,
            chunk.startTime,
            chunk.endTime
          );
          
          if (
            restTranscribed &&
            restTranscribed.trim().length > 0 &&
            !restTranscribed.includes("[Chunk") &&
            !restTranscribed.includes("No transcript")
          ) {
            finalTranscript = restTranscribed;
            console.log(`✓ Chunk ${chunk.chunkIndex} transcribed successfully via Gemini REST API (error fallback)`);
          } else {
            return; // Don't create placeholder entries
          }
        } catch (restError) {
          console.error(`Error with REST API fallback for chunk ${chunk.chunkIndex}:`, restError);
          return; // Don't create placeholder entries
        }
      }
    }

    // Skip storing placeholder messages
    const isPlaceholder = finalTranscript.includes("Transcription via Web Speech API") ||
                         finalTranscript.includes("Audio chunk") ||
                         finalTranscript.includes("No speech detected") ||
                         finalTranscript.includes("Transcription failed");

    if (!isPlaceholder) {
      // Check if chunk already exists (prevent duplicates)
      const existingChunk = await prisma.transcriptChunk.findFirst({
        where: {
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
        },
      });

      if (existingChunk) {
        // Update existing chunk - append new transcript if different
        if (existingChunk.transcript !== finalTranscript) {
          await prisma.transcriptChunk.update({
            where: { id: existingChunk.id },
            data: {
              transcript: finalTranscript, // Replace with latest (not append to avoid duplicates)
            },
          });
        }
      } else {
        // Create new chunk
        await prisma.transcriptChunk.create({
          data: {
            sessionId: chunk.sessionId,
            chunkIndex: chunk.chunkIndex,
            transcript: finalTranscript,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
          },
        });
      }

      // Update session transcript - check if this time range already exists
      const session = await prisma.appSession.findUnique({
        where: { id: chunk.sessionId },
      });

      if (session) {
        const existingTranscript = session.transcript || "";
        
        // Check if this time range already exists in the transcript
        const timeRangePattern = new RegExp(`\\[${chunk.startTime}s - ${chunk.endTime}s\\]`, 'g');
        const hasTimeRange = timeRangePattern.test(existingTranscript);
        
        if (hasTimeRange) {
          // Append to existing entry for this time range (combine all text under same time)
          // Match: [startTime - endTime] followed by any text until next [ or end of string
          const regex = new RegExp(`(\\[${chunk.startTime}s - ${chunk.endTime}s\\])([^\\[]*)`, 'g');
          const updatedTranscript = existingTranscript.replace(
            regex,
            (match: string, timeRange: string, existingText: string) => {
              // Append new transcript to existing text under same time range
              const combinedText = existingText.trim() 
                ? `${existingText.trim()} ${finalTranscript.trim()}`
                : finalTranscript.trim();
              return `${timeRange}\n${combinedText}`;
            }
          );
          
          await prisma.appSession.update({
            where: { id: chunk.sessionId },
            data: {
              transcript: updatedTranscript,
            },
          });
        } else {
          // Add new time range entry
          const updatedTranscript = existingTranscript
            ? `${existingTranscript}\n\n[${chunk.startTime}s - ${chunk.endTime}s]\n${finalTranscript}`
            : `[${chunk.startTime}s - ${chunk.endTime}s]\n${finalTranscript}`;

          await prisma.appSession.update({
            where: { id: chunk.sessionId },
            data: {
              transcript: updatedTranscript,
            },
          });
        }
      }
    } else {
      console.log(`Skipping placeholder transcript for chunk ${chunk.chunkIndex}`);
    }

    console.log(`Chunk ${chunk.chunkIndex} processed successfully`);
  } catch (error) {
    console.error(`Error processing chunk ${chunk.chunkIndex}:`, error);
    throw error;
  }
}

/**
 * Generate summary for completed session
 */
export async function generateSessionSummary(sessionId: string): Promise<string> {
  try {
    // Get all transcript chunks
    const chunks = await prisma.transcriptChunk.findMany({
      where: { sessionId },
      orderBy: { chunkIndex: "asc" },
    });

    // Combine all transcripts
    const fullTranscript = chunks
      .map((chunk: TranscriptChunk) => `[${chunk.startTime}s - ${chunk.endTime}s]\n${chunk.transcript}`)
      .join("\n\n");

    // Only generate summary if we have actual transcript content (not just placeholders or errors)
    // Check for real speech content (not error messages or placeholders)
    const hasRealTranscript = chunks.some(
      (chunk: TranscriptChunk) => {
        const text = chunk.transcript.trim();
        // Must have content and not be an error/placeholder message
        return text.length > 0 &&
          !text.startsWith("[") && // Not a placeholder like "[Audio chunk..."
          !text.includes("Audio transcription service not configured") &&
          !text.includes("Transcription failed") &&
          !text.includes("No speech detected") &&
          !text.includes("browser-based transcription placeholder");
      }
    );

    let summary: string;
    if (hasRealTranscript && fullTranscript.trim().length > 0) {
      // Generate summary using Gemini
      const { generateSummary } = await import("@/lib/gemini");
      summary = await generateSummary(fullTranscript);
    } else {
      summary = "No transcript available. Audio transcription service needs to be configured to generate summaries.";
    }

    // Update session with summary
    await prisma.appSession.update({
      where: { id: sessionId },
      data: {
        summary,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return summary;
  } catch (error) {
    console.error("Error generating summary:", error);
    
    // Mark session as failed
    await prisma.appSession.update({
      where: { id: sessionId },
      data: {
        status: "FAILED",
      },
    });

    throw error;
  }
}

