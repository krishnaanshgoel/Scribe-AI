"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { getSocket } from "@/lib/socket-client";

interface TabAudioCaptureProps {
  sessionId: string;
  onError?: (error: Error) => void;
  onStatusChange?: (status: string) => void;
}

export default function TabAudioCapture({
  sessionId,
  onError,
  onStatusChange,
}: TabAudioCaptureProps) {
  const [status, setStatus] = useState<"idle" | "connecting" | "requesting" | "streaming" | "stopping" | "error">("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);

  const updateStatus = useCallback((newStatus: typeof status) => {
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const start = useCallback(async () => {
    if (!sessionId) {
      const err = new Error("Session ID is required");
      onError?.(err);
      return;
    }

    try {
      updateStatus("connecting");

      // Get WebSocket URL
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/audio-stream?sessionId=${sessionId}`;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("WebSocket connected for tab audio streaming");
        updateStatus("requesting");
      };

      ws.onclose = () => {
        console.log("WebSocket closed");
        updateStatus("idle");
      };

      ws.onerror = (e) => {
        const error = new Error("WebSocket connection error");
        console.error("WebSocket error:", e);
        onError?.(error);
        updateStatus("error");
      };

      ws.onmessage = (m) => {
        if (typeof m.data === "string") {
          try {
            const msg = JSON.parse(m.data);
            if (msg.type === "ready") {
              console.log("Server ready for audio stream");
            } else if (msg.type === "chunk_received") {
              console.log(`Chunk ${msg.chunkIndex} received by server`);
            }
          } catch (e) {
            // Ignore non-JSON messages
          }
        }
      };

      wsRef.current = ws;

      // Request display media (user must pick a tab and check "Share audio")
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser", // Prefer browser tab
        } as MediaTrackConstraints,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        } as MediaTrackConstraints,
      });

      // Keep only audio tracks
      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) {
        const err = new Error('No audio track available. Please ensure you check "Share audio" when selecting the tab.');
        onError?.(err);
        updateStatus("error");
        displayStream.getTracks().forEach((t) => t.stop());
        ws.close();
        return;
      }

      const audioStream = new MediaStream(audioTracks);
      streamRef.current = displayStream; // Keep original so we can stop all tracks when ending

      console.log(`Got ${audioTracks.length} audio track(s)`);
      audioTracks.forEach((track) => {
        console.log(`  - Audio track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}`);
        
        // Handle when user stops sharing the tab
        track.onended = () => {
          console.log("Tab share ended - user stopped sharing");
          stop();
        };
      });

      // Create MediaRecorder
      const options: MediaRecorderOptions = { 
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      };

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(audioStream, options);
      } catch (e) {
        // Fallback to default mimeType
        recorder = new MediaRecorder(audioStream);
        console.warn("Using default MediaRecorder options:", e);
      }

      recorderRef.current = recorder;

      recorder.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ab = await ev.data.arrayBuffer();
          try {
            wsRef.current.send(ab);
            console.log(`Sent audio chunk ${chunkIndexRef.current}: ${ev.data.size} bytes`);
            
            // Notify server about chunk metadata
            if (wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: "chunk_metadata",
                chunkIndex: chunkIndexRef.current++,
                size: ev.data.size,
                timestamp: Date.now(),
              }));
            }
          } catch (err) {
            console.error("WebSocket send error:", err);
            onError?.(err instanceof Error ? err : new Error("Failed to send audio chunk"));
          }
        }
      };

      recorder.onstart = () => {
        console.log("MediaRecorder started");
        updateStatus("streaming");
        
        // Send start message
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "start",
            sessionId,
            timestamp: Date.now(),
            codec: recorder.mimeType || null,
          }));
        }
      };

      recorder.onstop = () => {
        console.log("MediaRecorder stopped");
        updateStatus("stopping");
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: "stop",
            sessionId,
            timestamp: Date.now(),
          }));
          wsRef.current.close();
        }
        updateStatus("idle");
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        const error = new Error("MediaRecorder error occurred");
        onError?.(error);
        updateStatus("error");
      };

      // Start recording with small timeslice for low latency (500ms chunks)
      const timeslice = 500; // ms
      recorder.start(timeslice);
      chunkIndexRef.current = 0;

    } catch (err) {
      console.error("Start error:", err);
      const error = err instanceof Error ? err : new Error("Failed to start tab audio capture");
      onError?.(error);
      updateStatus("error");
      
      // Cleanup on error
      if (wsRef.current) {
        wsRef.current.close();
      }
    }
  }, [sessionId, onError, updateStatus]);

  const stop = useCallback(() => {
    updateStatus("stopping");
    
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      
      wsRef.current = null;
      recorderRef.current = null;
      chunkIndexRef.current = 0;
    } catch (e) {
      console.error("Stop error:", e);
    }
    
    updateStatus("idle");
  }, [updateStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    start,
    stop,
    status,
    isStreaming: status === "streaming",
  };
}

