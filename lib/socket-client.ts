"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on("connect", () => {
      console.log("Connected to WebSocket server");
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from WebSocket server");
    });

    socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
    });
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Socket event types
export interface SessionStartData {
  sessionId: string;
  userId: string;
  recordingMode: "MIC" | "TAB";
}

export interface AudioChunkData {
  sessionId: string;
  audioData: ArrayBuffer | Blob;
  chunkIndex: number;
  timestamp: number;
}

export interface TranscriptUpdate {
  sessionId: string;
  transcript: string;
  chunkIndex: number;
}

