// Load environment variables from .env file
import { config } from "dotenv";
config();

import { createServer } from "http";
import { Server } from "socket.io";
import { parse } from "url";
import next from "next";
import type { Server as HTTPServer } from "http";
import type { Socket as NetSocket } from "net";
import type { Server as SocketIOServer } from "socket.io";
import { processAudioChunk } from "./services/transcription";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

// Create Next.js app
const nextApp = next({ dev, hostname, port });
const nextHandler = nextApp.getRequestHandler();

// Socket.io types
interface SocketServer extends HTTPServer {
  io?: SocketIOServer | undefined;
}

interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

nextApp.prepare().then(() => {
  const httpServer: SocketServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await nextHandler(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // WebSocket server for raw audio streaming (from TabAudioCapture component)
  // @ts-ignore - ws types
  const WebSocketServer = require("ws").WebSocketServer;
  const audioWss = new WebSocketServer({ noServer: true });
  
  // Attach our upgrade handler BEFORE Socket.io initializes
  // This ensures our handler gets called first
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = parse(request.url || "", true).pathname;
    
    // Route to audio WebSocket server
    if (pathname === "/api/audio-stream") {
      console.log("Upgrade request for /api/audio-stream");
      try {
        audioWss.handleUpgrade(request, socket, head, (ws: any) => {
          // Store request for later use when io is available
          (ws as any)._request = request;
        });
      } catch (error) {
        console.error("Error handling WebSocket upgrade:", error);
        socket.destroy();
      }
      return; // Don't let Socket.io handle this
    }
    // For other paths, let Socket.io handle them
  });
  
  // Initialize Socket.io AFTER our upgrade handler
  const io = new Server(httpServer, {
    path: "/api/socket",
    addTrailingSlash: false,
    cors: {
      origin: dev ? "*" : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  httpServer.io = io;
  
  // Handle WebSocket connections now that io is available
  audioWss.on("connection", (ws: any) => {
    handleAudioWebSocket(ws, ws._request || {}, io);
  });

  function handleAudioWebSocket(ws: any, request: any, io: SocketIOServer) {
    try {
      const url = parse(request.url || "", true);
      const sessionId = url.query?.sessionId as string;
      
      if (!sessionId) {
        ws.close(1008, "Missing sessionId");
        return;
      }
      
      console.log(`Audio WebSocket connection for session ${sessionId}`);
      
      let chunkIndex = 0;
      let audioBuffer = Buffer.alloc(0);
      const CHUNK_DURATION_MS = 30000; // 30 seconds
      let lastChunkTime = Date.now();
      let sessionStarted = false;
      
      ws.on("message", async (data: Buffer | string) => {
        // Handle JSON control messages
        if (typeof data === "string" || Buffer.isBuffer(data) && data[0] === 0x7B) {
          try {
            const text = typeof data === "string" ? data : data.toString();
            const msg = JSON.parse(text);
            
            if (msg.type === "start") {
              sessionStarted = true;
              ws.send(JSON.stringify({ type: "ready", sessionId }));
              console.log(`Audio stream started for session ${sessionId}`);
              return;
            }
            
            if (msg.type === "stop") {
              console.log(`Audio stream stopped for session ${sessionId}`);
              // Send any remaining audio
              if (audioBuffer.length > 0) {
                await sendAudioChunk(audioBuffer, chunkIndex++, sessionId, io);
                audioBuffer = Buffer.alloc(0);
              }
              ws.close();
              return;
            }
            
            if (msg.type === "chunk_metadata") {
              // Just acknowledge, audio data comes as binary
              return;
            }
          } catch (e) {
            // Not JSON, treat as binary
          }
        }
        
        // Handle binary audio data
        if (Buffer.isBuffer(data)) {
          audioBuffer = Buffer.concat([audioBuffer, data]);
          
          const now = Date.now();
          // Send chunk every 30 seconds or when buffer is large enough (~500KB)
          if (now - lastChunkTime >= CHUNK_DURATION_MS || audioBuffer.length > 500000) {
            if (audioBuffer.length > 0 && sessionStarted) {
              await sendAudioChunk(audioBuffer, chunkIndex++, sessionId, io);
              audioBuffer = Buffer.alloc(0);
              lastChunkTime = now;
              
              // Acknowledge chunk received
              ws.send(JSON.stringify({
                type: "chunk_received",
                chunkIndex: chunkIndex - 1,
              }));
            }
          }
        }
      });
      
      ws.on("close", async () => {
        // Send any remaining audio
        if (audioBuffer.length > 0 && sessionStarted) {
          await sendAudioChunk(audioBuffer, chunkIndex++, sessionId, io);
        }
        console.log(`Audio WebSocket closed for session ${sessionId}`);
      });
      
      ws.on("error", (error: Error) => {
        console.error(`Audio WebSocket error for session ${sessionId}:`, error);
      });
      
      // Send initial ready message
      ws.send(JSON.stringify({ type: "ready", sessionId }));
    } catch (error) {
      console.error("Error in handleAudioWebSocket:", error);
      ws.close(1011, "Internal server error");
    }
  }
  
  async function sendAudioChunk(
    audioBuffer: Buffer,
    chunkIndex: number,
    sessionId: string,
    io: SocketIOServer
  ) {
    // Emit as audio chunk via Socket.io to the session room
    // This integrates with existing audio:chunk handler
    io.to(`session:${sessionId}`).emit("audio:chunk", {
      sessionId,
      audioData: Array.from(audioBuffer),
      chunkIndex,
      timestamp: Date.now(),
    });
    
    // Also process directly for transcription
    const chunkDuration = 30;
    const startTime = chunkIndex * chunkDuration;
    const endTime = startTime + chunkDuration;
    
    try {
      await processAudioChunk({
        sessionId,
        chunkIndex,
        audioData: audioBuffer,
        startTime,
        endTime,
      });
    } catch (error) {
      console.error(`Error processing audio chunk ${chunkIndex}:`, error);
    }
  }

  // Store session metadata (recordingMode, chunkDuration)
  const sessionMetadata = new Map<string, { recordingMode: string; chunkDuration: number }>();

  // Socket.io connection handling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Handle session start
    socket.on("session:start", async (data) => {
      try {
        const { sessionId, userId, recordingMode } = data;
        
        // Validate sessionId
        if (!sessionId || sessionId.trim() === "") {
          console.error("Invalid sessionId received in session:start:", sessionId);
          socket.emit("session:error", { message: "Invalid session ID" });
          return;
        }
        
        console.log(`Session started: ${sessionId} by user ${userId}, mode: ${recordingMode}`);
        
        // Store session metadata
        // TAB mode uses 5-second chunks, MIC mode uses 30-second chunks
        const chunkDuration = recordingMode === "TAB" ? 5 : 30;
        sessionMetadata.set(sessionId, { recordingMode, chunkDuration });
        console.log(`[${recordingMode}] Stored session metadata: chunkDuration=${chunkDuration}s`);
        
        // Join room for this session
        socket.join(`session:${sessionId}`);
        
        // Start Gemini Live API WebSocket session for real-time transcription
        let websocketStarted = false;
        try {
          const { startLiveSession } = await import("./services/gemini-live-websocket");
          await startLiveSession(sessionId, socket);
          websocketStarted = true;
          console.log(`✓ Gemini Live API WebSocket session started for ${sessionId}`);
        } catch (error) {
          console.warn("Failed to start Gemini Live API WebSocket session:", error);
          // Try REST API fallback
          try {
            const { startLiveSession: startLiveSessionREST } = await import("./services/gemini-live-rest");
            await startLiveSessionREST(sessionId, socket);
            console.log(`✓ Gemini Live API REST session started for ${sessionId} (fallback)`);
          } catch (restError) {
            console.warn("Failed to start Gemini Live API REST session:", restError);
            // Continue even if both fail - transcription will be skipped
          }
        }
        
        // Emit confirmation
        socket.emit("session:started", { sessionId, status: "recording" });
      } catch (error) {
        console.error("Error starting session:", error);
        socket.emit("session:error", { message: "Failed to start session" });
      }
    });

    // Handle audio chunk
    socket.on("audio:chunk", async (data) => {
      try {
        const { sessionId, audioData, chunkIndex, timestamp } = data;
        
        // Validate sessionId
        if (!sessionId || sessionId.trim() === "") {
          console.error("Invalid sessionId received in audio chunk:", sessionId);
          socket.emit("audio:error", { 
            message: "Invalid session ID", 
            chunkIndex 
          });
          return;
        }
        
        // Get session metadata to determine chunk duration
        const metadata = sessionMetadata.get(sessionId);
        const chunkDuration = metadata?.chunkDuration || 30; // Default to 30 seconds if not found
        const recordingMode = metadata?.recordingMode || "UNKNOWN";
        
        console.log(`[${recordingMode}] Received audio chunk ${chunkIndex} for session ${sessionId} (size: ${audioData.length} bytes, duration: ${chunkDuration}s)`);
        
        // Convert array back to Buffer
        const audioBuffer = Buffer.from(audioData);
        
        // Calculate timing based on actual chunk duration
        const startTime = chunkIndex * chunkDuration;
        const endTime = startTime + chunkDuration;
        
        // Acknowledge receipt of chunk immediately
        socket.emit("audio:received", {
          chunkIndex,
          timestamp: Date.now(),
        });

        // Process audio chunk in background (don't await - process asynchronously)
        // Note: If no Gemini session, processAudioChunk will return early
        // Web Speech API transcripts are handled separately via transcript:chunk event
        processAudioChunk({
          sessionId,
          chunkIndex,
          audioData: audioBuffer,
          startTime,
          endTime,
        })
          .then(async () => {
            // Get the stored transcript chunk from database (only if it exists)
            const { prisma } = await import("@/lib/prisma");
            const chunk = await prisma.transcriptChunk.findFirst({
              where: {
                sessionId,
                chunkIndex,
              },
            });

            // Only emit if chunk exists and is not a placeholder
            if (chunk && !chunk.transcript.includes("Transcription via Web Speech API") && 
                !chunk.transcript.includes("Audio chunk")) {
              // Emit transcript update with actual stored transcript
              socket.emit("transcript:updated", {
                sessionId,
                transcript: chunk.transcript,
                chunkIndex,
              });
            }
          })
          .catch((error) => {
            console.error(`Error processing chunk ${chunkIndex}:`, error);
            // Don't emit error for skipped chunks (no Gemini session)
            if (!error.message?.includes("no active WebSocket session")) {
              socket.emit("audio:error", {
                message: `Failed to process chunk ${chunkIndex}`,
                chunkIndex,
              });
            }
          });
        
        // Acknowledge receipt
        socket.emit("audio:received", {
          sessionId,
          chunkIndex,
          timestamp,
        });
      } catch (error) {
        console.error("Error handling audio chunk:", error);
        socket.emit("audio:error", { message: "Failed to process audio chunk" });
      }
    });

    // Handle pause
    socket.on("session:pause", async (data) => {
      try {
        const { sessionId } = data;
        socket.to(`session:${sessionId}`).emit("session:paused", { sessionId });
      } catch (error) {
        console.error("Error pausing session:", error);
      }
    });

    // Handle resume
    socket.on("session:resume", async (data) => {
      try {
        const { sessionId } = data;
        socket.to(`session:${sessionId}`).emit("session:resumed", { sessionId });
      } catch (error) {
        console.error("Error resuming session:", error);
      }
    });

    // Handle transcript chunks from browser (Web Speech API)
    socket.on("transcript:chunk", async (data) => {
      try {
        const { sessionId, transcript, chunkIndex, timestamp } = data;
        
        if (!sessionId || sessionId.trim() === "") {
          console.error("Invalid sessionId in transcript chunk");
          return;
        }

        // Filter out placeholder messages BEFORE storing
        const isPlaceholder = transcript.includes("Transcription via Web Speech API") ||
                             transcript.includes("Audio chunk") ||
                             transcript.includes("recorded from") ||
                             transcript.includes("No speech detected") ||
                             transcript.includes("Transcription failed") ||
                             /\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g.test(transcript);

        if (isPlaceholder) {
          console.log(`[FILTER] Skipping placeholder transcript chunk ${chunkIndex}: "${transcript.substring(0, 50)}..."`);
          return; // Don't store placeholder messages
        }

        // Log actual transcriptions for debugging
        console.log(`[TRANSCRIPT] Chunk ${chunkIndex} for session ${sessionId}: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`);

        // Store transcript chunk in database
        const { prisma } = await import("@/lib/prisma");
        
        // Calculate timing (assuming 30-second chunks)
        const chunkDuration = 30;
        const startTime = chunkIndex * chunkDuration;
        const endTime = startTime + chunkDuration;

        // Check if chunk already exists
        const existingChunk = await prisma.transcriptChunk.findFirst({
          where: {
            sessionId,
            chunkIndex,
          },
        });

        if (existingChunk) {
          // Update existing chunk - check if transcript is different before updating
          // Only append if the new transcript is not already contained in existing transcript
          const existingText = existingChunk.transcript.trim();
          const newText = transcript.trim();
          
          // Check if new text is already in existing text (avoid duplicates)
          if (existingText.includes(newText)) {
            console.log(`[SKIP] Chunk ${chunkIndex} already contains this transcript, skipping update`);
            return;
          }
          
          // Append new text only if it's different
          const updatedTranscript = existingText 
            ? `${existingText} ${newText}`
            : newText;
          
          await prisma.transcriptChunk.update({
            where: { id: existingChunk.id },
            data: {
              transcript: updatedTranscript.trim(),
            },
          });
          console.log(`[UPDATE] Updated existing transcript chunk ${chunkIndex} (${startTime}s-${endTime}s)`);
        } else {
          // Create NEW chunk for this 30-second interval
          // Each 30-second interval gets its own row: 0-30s, 30-60s, 60-90s, etc.
          await prisma.transcriptChunk.create({
            data: {
              sessionId,
              chunkIndex,
              transcript: transcript.trim(),
              startTime,
              endTime,
            },
          });
          console.log(`[CREATE] Created new transcript chunk ${chunkIndex} (${startTime}s-${endTime}s)`);
        }

        // Update session transcript - check if this time range already exists
        const session = await prisma.appSession.findUnique({
          where: { id: sessionId },
        });

        if (session) {
          const existingTranscript = session.transcript || "";
          
          // Check if this time range already exists in the transcript
          const timeRangePattern = new RegExp(`\\[${startTime}s - ${endTime}s\\]`, 'g');
          const hasTimeRange = timeRangePattern.test(existingTranscript);
          
          if (hasTimeRange) {
            // Append to existing entry for this time range (combine all text under same time)
            // Match: [startTime - endTime] followed by any text until next [ or end of string
            const regex = new RegExp(`(\\[${startTime}s - ${endTime}s\\])([^\\[]*)`, 'g');
            const updatedTranscript = existingTranscript.replace(
              regex,
              (match: string, timeRange: string, existingText: string) => {
                // Append new transcript to existing text under same time range
                const combinedText = existingText.trim() 
                  ? `${existingText.trim()} ${transcript.trim()}`
                  : transcript.trim();
                return `${timeRange}\n${combinedText}`;
              }
            );
            
            await prisma.appSession.update({
              where: { id: sessionId },
              data: {
                transcript: updatedTranscript,
              },
            });
          } else {
            // Add new time range entry
            const updatedTranscript = existingTranscript
              ? `${existingTranscript}\n\n[${startTime}s - ${endTime}s]\n${transcript}`
              : `[${startTime}s - ${endTime}s]\n${transcript}`;

            await prisma.appSession.update({
              where: { id: sessionId },
              data: {
                transcript: updatedTranscript,
              },
            });
          }
        }

        // Only emit if transcript is not a placeholder
        const isPlaceholderMessage = transcript.includes("Transcription via Web Speech API") ||
                                     transcript.includes("Audio chunk") ||
                                     transcript.includes("No speech detected") ||
                                     transcript.includes("Transcription failed");
        
        if (!isPlaceholderMessage) {
          // Emit transcript update to client for live display
          socket.emit("transcript:updated", {
            sessionId,
            transcript,
            chunkIndex,
          });
          
          // Also emit to the room for other clients
          socket.to(`session:${sessionId}`).emit("transcript:updated", {
            sessionId,
            transcript,
            chunkIndex,
          });
          
          console.log(`✓ Emitted live transcript update for chunk ${chunkIndex}`);
        }

        console.log(`✓ Transcript chunk ${chunkIndex} stored successfully`);
      } catch (error) {
        console.error("Error handling transcript chunk:", error);
        socket.emit("transcript:error", {
          message: "Failed to store transcript chunk",
          chunkIndex: data.chunkIndex,
        });
      }
    });

    // Handle stop
    socket.on("session:stop", async (data) => {
      try {
        const { sessionId } = data;
        
        // Clean up session metadata
        sessionMetadata.delete(sessionId);
        
        // Stop Gemini Live API WebSocket session
        try {
          const { stopLiveSession } = await import("./services/gemini-live-websocket");
          await stopLiveSession(sessionId);
          console.log(`✓ Gemini Live API WebSocket session stopped for ${sessionId}`);
        } catch (error) {
          console.warn("Error stopping Gemini Live API WebSocket session:", error);
        }
        
        // Also stop REST API session if it exists
        try {
          const { stopLiveSession: stopLiveSessionREST } = await import("./services/gemini-live-rest");
          await stopLiveSessionREST(sessionId);
          console.log(`✓ Gemini Live API REST session stopped for ${sessionId}`);
        } catch (error) {
          // Ignore errors - session might not exist
        }
        
        socket.to(`session:${sessionId}`).emit("session:stopped", { sessionId });
        socket.leave(`session:${sessionId}`);
      } catch (error) {
        console.error("Error stopping session:", error);
      }
    });

    // Handle transcript update
    socket.on("transcript:update", async (data) => {
      try {
        const { sessionId, transcript, chunkIndex } = data;
        socket.to(`session:${sessionId}`).emit("transcript:updated", {
          sessionId,
          transcript,
          chunkIndex,
        });
      } catch (error) {
        console.error("Error updating transcript:", error);
      }
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server running on /api/socket`);
    console.log(`> Audio WebSocket server ready on /api/audio-stream`);
    console.log(`> Upgrade handlers: ${httpServer.listeners("upgrade").length} registered`);
  });
});

