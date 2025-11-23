"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { getSocket } from "@/lib/socket-client";
import type { RecordingMode } from "@/lib/types";

// Web Speech API types
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface UseRecordingOptions {
  sessionId: string;
  userId: string;
  recordingMode: RecordingMode;
  onTranscriptUpdate?: (transcript: string, chunkIndex: number) => void;
  onError?: (error: Error) => void;
}

export function useRecording({
  sessionId,
  userId,
  recordingMode,
  onTranscriptUpdate,
  onError,
}: UseRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const chunkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef(getSocket());
  const isPausedRef = useRef(false); // Use ref to avoid closure issues in callbacks
  const sessionIdRef = useRef(sessionId); // Use ref to always have current sessionId
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptBufferRef = useRef<string>(""); // Buffer for accumulating transcripts
  const transcriptChunkIndexRef = useRef(0); // Track transcript chunks
  const isRecordingRef = useRef(false); // Use ref to track recording state
  const recordingStartTimeRef = useRef<number>(0); // Track when recording started for chunk index calculation
  
  // Update sessionId ref when it changes
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Initialize Web Speech API (FREE - no API keys needed!)
  // NOTE: Web Speech API only works with microphone input, NOT tab audio
  // For TAB mode, we rely on server-side transcription from MediaRecorder chunks
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Don't initialize Web Speech API for TAB mode - it can't transcribe tab audio
    if (recordingMode === "TAB") {
      console.log("TAB mode: Skipping Web Speech API (only works with microphone). Using server-side transcription.");
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("Web Speech API is not supported in this browser. Transcription will be limited.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // Show interim results for live transcription
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1; // Only need one result for faster processing

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Check if we should process results (not paused and recording)
      if (isPausedRef.current) {
        console.log("Skipping transcript - recording is paused");
        return;
      }
      
      // Use ref instead of state to avoid stale closure issues
      if (!isRecordingRef.current) {
        console.log("Skipping transcript - not recording (ref check)");
        return;
      }

      let interimTranscript = "";
      let finalTranscript = "";

      // Process results - Web Speech API sends incremental updates
      // event.resultIndex tells us where to start processing
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // Final transcript - add to buffer
          finalTranscript += transcript + " ";
        } else {
          // Interim transcript - this is the CURRENT incremental text being built
          // Don't accumulate - just use the latest interim result
          interimTranscript = transcript; // Replace, don't accumulate
        }
      }

      // Calculate chunk index based on recording time (always, even for interim)
      // This aligns with audio chunks (30 seconds each)
      const recordingTime = recordingStartTimeRef.current > 0 
        ? Date.now() - recordingStartTimeRef.current 
        : 0;
      const chunkIndex = Math.max(0, Math.floor(recordingTime / 30000)); // Ensure chunk 0 is included

      // Show INTERIM transcripts immediately for live updates (as user speaks)
      // Web Speech API interim results contain the FULL sentence being built (including all previous final results)
      // So we should only show the interim text itself, not combine with buffer
      if (interimTranscript.trim() && onTranscriptUpdate) {
        // Show interim results IMMEDIATELY for real-time feedback
        // This provides instant visual feedback as user speaks
        // Send immediately - no threshold for interim results
        onTranscriptUpdate(interimTranscript.trim(), chunkIndex);
        
        // Also send to server immediately for first 10 seconds (no threshold)
        if (recordingTime < 10000) {
          socketRef.current.emit("transcript:chunk", {
            sessionId: sessionIdRef.current,
            transcript: interimTranscript.trim(),
            chunkIndex: 0, // First 10 seconds are chunk 0
            timestamp: Date.now(),
          });
        }
      }

      // Update buffer with final transcripts
      if (finalTranscript.trim()) {
        // Add final transcript to buffer
        transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + finalTranscript.trim();
        
        // IMMEDIATELY update UI with final transcript for live transcription
        // This provides real-time feedback as user speaks
        const finalText = transcriptBufferRef.current.trim();
        onTranscriptUpdate?.(finalText, chunkIndex);
        
        // Send transcript chunk to server immediately (no threshold for final transcripts)
        // This ensures all speech is captured, especially in first 10 seconds
        const transcriptToSend = transcriptBufferRef.current.trim();
        
        if (transcriptToSend.length > 0) {
          console.log(`Sending transcript chunk ${chunkIndex}: "${transcriptToSend.substring(0, 50)}..."`);
          
          // Send transcript to server via socket
          socketRef.current.emit("transcript:chunk", {
            sessionId: sessionIdRef.current,
            transcript: transcriptToSend,
            chunkIndex,
            timestamp: Date.now(),
          });

          // Clear buffer after sending
          transcriptBufferRef.current = "";
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        const error = new Error(`Speech recognition error: ${event.error}`);
        setError(error);
        onError?.(error);
      }
    };

    recognition.onend = () => {
      // Restart recognition if we're still recording and not paused
      // Use a small delay to avoid immediate restart issues
      if (isRecordingRef.current && !isPausedRef.current && recognition) {
        setTimeout(() => {
          try {
            if (isRecordingRef.current && !isPausedRef.current) {
              recognition.start();
              console.log("Web Speech API restarted");
            }
          } catch (error) {
            // Ignore errors when restarting (might already be starting)
            console.log("Web Speech API restart skipped:", error);
          }
        }, 100);
      }
    };
    
    recognition.onstart = () => {
      console.log("✓ Web Speech API recognition started");
    };

    speechRecognitionRef.current = recognition;

    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current.abort();
      }
    };
  }, [onTranscriptUpdate, onError, recordingMode]); // Add recordingMode to deps

  // Handle transcript updates from server
  useEffect(() => {
    const socket = socketRef.current;

    const handleTranscriptUpdate = (data: { transcript: string; chunkIndex: number }) => {
      onTranscriptUpdate?.(data.transcript, data.chunkIndex);
    };

    const handleSessionStarted = () => {
      console.log("Session started on server");
    };

    const handleSessionError = (data: { message: string }) => {
      const err = new Error(data.message);
      setError(err);
      onError?.(err);
    };

    socket.on("transcript:updated", handleTranscriptUpdate);
    socket.on("session:started", handleSessionStarted);
    socket.on("session:error", handleSessionError);

    return () => {
      socket.off("transcript:updated", handleTranscriptUpdate);
      socket.off("session:started", handleSessionStarted);
      socket.off("session:error", handleSessionError);
    };
  }, [onTranscriptUpdate, onError]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      
      // Validate sessionId is set
      if (!sessionIdRef.current || sessionIdRef.current.trim() === "") {
        const err = new Error("Session ID is required. Please create a session first.");
        setError(err);
        onError?.(err);
        return; // Don't throw, just set error and return
      }
      
      console.log(`Starting recording for session: ${sessionIdRef.current}`);
      
      // Reset transcript buffer
      transcriptBufferRef.current = "";
      transcriptChunkIndexRef.current = 0;
      
      // Store recording start time to calculate chunk indices
      recordingStartTimeRef.current = Date.now();
      
      // Create initial chunk 0 immediately for live display
      // This ensures chunk 0 exists even before first transcript arrives
      onTranscriptUpdate?.("", 0);
      
      let stream: MediaStream;
      let streamObtained = false;
      let useWebSocket = false; // Declare outside if block for scope
      let ws: WebSocket | null = null;
      
      if (recordingMode === "TAB") {
        // Try WebSocket streaming first, fallback to regular MediaRecorder if it fails
        
        try {
          // Get WebSocket URL for audio streaming
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          const host = window.location.host;
          const wsUrl = `${protocol}//${host}/api/audio-stream?sessionId=${sessionIdRef.current}`;

          ws = new WebSocket(wsUrl);
          ws.binaryType = "arraybuffer";

          // Try to connect with a short timeout
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              ws?.close();
              reject(new Error("WebSocket connection timeout"));
            }, 3000); // Shorter timeout - 3 seconds

            ws!.onopen = () => {
              clearTimeout(timeout);
              console.log("✓ WebSocket connected for tab audio streaming");
              useWebSocket = true;
              resolve();
            };

            ws!.onerror = (error) => {
              clearTimeout(timeout);
              console.warn("WebSocket connection failed, falling back to MediaRecorder:", error);
              reject(new Error("WebSocket unavailable"));
            };
            
            ws!.onclose = (event) => {
              clearTimeout(timeout);
              if (event.code !== 1000 && event.code !== 1001) {
                console.warn(`WebSocket closed: code ${event.code}, falling back to MediaRecorder`);
                reject(new Error("WebSocket unavailable"));
              }
            };
          });
        } catch (wsError) {
          console.log("WebSocket streaming not available, using standard MediaRecorder approach");
          ws = null;
          useWebSocket = false;
          // Fall through to regular getDisplayMedia approach
        }
        
        // If WebSocket connected successfully, use it for streaming
        if (useWebSocket && ws) {
          try {
            // Request display media
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
            if (audioTracks.length === 0) {
              const err = new Error('No audio track available. Please ensure you check "Share audio" when selecting the tab.');
              setError(err);
              onError?.(err);
              displayStream.getTracks().forEach((t) => t.stop());
              ws?.close();
              return;
            }

            const audioStream = new MediaStream(audioTracks);
            streamRef.current = displayStream;

            console.log(`✓ Tab audio captured: ${audioTracks.length} audio track(s)`);
            audioTracks.forEach(track => {
              console.log(`  - Audio track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}`);
              
              track.onended = () => {
                console.warn("Tab share ended - user stopped sharing");
                if (isRecordingRef.current) {
                  setError(new Error("Tab sharing was stopped. Recording has been stopped."));
                  stopRecording();
                }
              };
            });

            // Create MediaRecorder for WebSocket streaming
            const options: MediaRecorderOptions = {
              mimeType: "audio/webm;codecs=opus",
              audioBitsPerSecond: 128000,
            };

            let recorder: MediaRecorder;
            try {
              recorder = new MediaRecorder(audioStream, options);
            } catch (e) {
              recorder = new MediaRecorder(audioStream);
            }

            let wsChunkIndex = 0;

            recorder.ondataavailable = async (ev) => {
              if (ev.data && ev.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
                const ab = await ev.data.arrayBuffer();
                try {
                  ws.send(ab);
                  ws.send(JSON.stringify({
                    type: "chunk_metadata",
                    chunkIndex: wsChunkIndex++,
                    size: ev.data.size,
                    timestamp: Date.now(),
                  }));
                  console.log(`Sent audio chunk ${wsChunkIndex - 1}: ${ev.data.size} bytes`);
                } catch (err) {
                  console.error("WebSocket send error:", err);
                }
              }
            };

            recorder.onstart = () => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "start",
                  sessionId: sessionIdRef.current,
                  timestamp: Date.now(),
                  codec: recorder.mimeType || null,
                }));
              }
            };

            recorder.onstop = () => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "stop",
                  sessionId: sessionIdRef.current,
                  timestamp: Date.now(),
                }));
                ws.close();
              }
            };

            // Store WebSocket for cleanup
            (streamRef.current as any)._ws = ws;
            (streamRef.current as any)._recorder = recorder;

            // Start recording with small timeslice for low latency
            recorder.start(500); // 500ms chunks
            
            // Set stream for cleanup purposes
            stream = audioStream;
            streamObtained = true;
            
            // WebSocket streaming is active - skip regular MediaRecorder setup below
            // Continue to set recording state and notify server
            
          } catch (wsStreamError) {
            // Error in WebSocket streaming path (e.g., getDisplayMedia failed)
            console.error("Error in WebSocket streaming path:", wsStreamError);
            if (ws) {
              ws.close();
            }
            // Fall through to regular approach
            useWebSocket = false;
            ws = null;
          }
        }
      }
      
      // Regular getDisplayMedia approach (fallback if WebSocket not used)
      if (recordingMode === "TAB" && !useWebSocket) {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: "browser", // Prefer browser tab over entire screen
            } as MediaTrackConstraints,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              sampleRate: 44100,
              // Try to capture system audio (browser tab audio)
              systemAudio: "include" as any, // Some browsers support this
            } as MediaTrackConstraints,
          });

          streamObtained = true;

          // Filter out video tracks - we only want audio
          const videoTracks = stream.getVideoTracks();
          videoTracks.forEach(track => {
            track.stop(); // Stop video track
            stream.removeTrack(track); // Remove from stream
          });

          // Wait a bit for audio tracks to become available (YouTube videos may need a moment)
          // Some browsers/tabs don't provide audio tracks immediately
          let audioTracks = stream.getAudioTracks();
          let attempts = 0;
          const maxAttempts = 10; // Wait up to 1 second (10 * 100ms)
          
          while (audioTracks.length === 0 && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            audioTracks = stream.getAudioTracks();
            attempts++;
          }

          // Check if we have audio tracks
          if (audioTracks.length === 0) {
            const err = new Error("No audio track available. Please ensure:\n1. The video/tab is playing audio\n2. You selected a tab with audio (e.g., YouTube, Google Meet, Zoom)\n3. The video is not muted in the browser tab");
            setError(err);
            onError?.(err);
            // Clean up stream
            stream.getTracks().forEach(track => track.stop());
            return; // Don't throw, just set error and return
          }

          // Check if tracks are muted and try to enable them
          audioTracks.forEach(track => {
            if (track.muted) {
              console.warn(`Audio track "${track.label}" is muted - attempting to unmute`);
              // Try to enable the track (may not work if browser muted it)
              track.enabled = true;
            }
          });

          // Wait a bit more and check again if tracks are still muted
          await new Promise(resolve => setTimeout(resolve, 200));
          const stillMuted = audioTracks.some(track => track.muted);
          
          if (stillMuted) {
            console.warn("Some audio tracks are still muted - audio may not be captured");
          }

          console.log(`✓ Tab share audio captured: ${audioTracks.length} audio track(s)`);
          audioTracks.forEach(track => {
            console.log(`  - Audio track: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}, readyState: ${track.readyState}`);
          });

          // Handle when user stops sharing the tab
          audioTracks.forEach(track => {
            track.onended = () => {
              console.warn("Tab share ended - user stopped sharing");
              if (isRecordingRef.current) {
                // Auto-stop recording if user stops sharing
                setError(new Error("Tab sharing was stopped. Recording has been stopped."));
                stopRecording();
              }
            };
          });
        } catch (error) {
          // Handle different error types gracefully - don't throw, just set error state
          let handled = false;
          
          if (error instanceof Error) {
            if (error.name === "NotAllowedError" || error.name === "AbortError") {
              // User cancelled the share dialog - this is expected behavior, not an error
              const cancelError = new Error("Tab sharing was cancelled. You can try again by clicking 'Start Session'.");
              setError(cancelError);
              setIsRecording(false);
              isRecordingRef.current = false;
              handled = true;
            } else if (error.name === "NotFoundError") {
              const err = new Error("No audio source found. Please ensure the tab you're sharing has audio (e.g., Google Meet, Zoom).");
              setError(err);
              onError?.(err);
              setIsRecording(false);
              isRecordingRef.current = false;
              handled = true;
            } else if (error.name === "NotSupportedError") {
              const err = new Error("Tab sharing is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.");
              setError(err);
              onError?.(err);
              setIsRecording(false);
              isRecordingRef.current = false;
              handled = true;
            }
          }
          
          // If we handled the error, return early without throwing
          if (handled) {
            return;
          }
          
          // For unexpected errors, set error state and return (don't throw)
          const err = error instanceof Error ? error : new Error("Failed to start tab sharing");
          setError(err);
          onError?.(err);
          setIsRecording(false);
          isRecordingRef.current = false;
          return;
        }
        
        // If stream wasn't obtained, return early
        if (!streamObtained || !stream) {
          return;
        }
      } else {
        // Request microphone access
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          },
        });
      }

      streamRef.current = stream;

      // Log stream info for debugging
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log(`Stream obtained (${recordingMode}):`, {
        id: stream.id,
        active: stream.active,
        audioTracks: audioTracks.length,
        videoTracks: videoTracks.length,
        tracks: stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: t.muted,
          label: t.label,
        })),
      });

      // Ensure we have audio tracks
      if (audioTracks.length === 0) {
        const err = new Error("No audio tracks available. Please ensure audio is enabled.");
        setError(err);
        onError?.(err);
        // Clean up stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        setIsRecording(false);
        isRecordingRef.current = false;
        return;
      }

      // For TAB mode, wait a bit more and verify audio tracks are actually active and not muted
      // This gives YouTube videos and other sources time to start playing audio
      if (recordingMode === "TAB") {
        // Wait a bit more for audio to become active (especially for YouTube videos)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Re-check audio tracks after waiting
        const currentAudioTracks = stream.getAudioTracks();
        const activeAudioTracks = currentAudioTracks.filter(track => 
          track.readyState === "live" && track.enabled && !track.muted
        );
        
        if (activeAudioTracks.length === 0) {
          const err = new Error("Audio tracks are not active. Please ensure:\n1. The video/tab is playing audio\n2. The video is not muted in the browser tab\n3. You selected a tab with audio (e.g., YouTube, Google Meet, Zoom)\n4. The video has started playing before sharing");
          setError(err);
          onError?.(err);
          // Clean up stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }
          setIsRecording(false);
          isRecordingRef.current = false;
          return;
        }
        
        console.log(`✓ Verified ${activeAudioTracks.length} active audio track(s) for tab sharing`);
      }

      // Monitor audio track state to detect unexpected stops
      // Note: For TAB mode, track.onended is already set above
      if (recordingMode === "MIC") {
        audioTracks.forEach((track) => {
          track.onended = () => {
            console.warn(`Audio track ended: ${track.label}`);
            if (isRecordingRef.current && mediaRecorderRef.current && 
                (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused")) {
              console.error("Audio track ended while recording - stopping recording");
              setError(new Error("Audio track ended unexpectedly"));
              stopRecording();
            }
          };
          
          track.onmute = () => {
            console.warn(`Audio track muted: ${track.label}`);
          };
          
          track.onunmute = () => {
            console.log(`Audio track unmuted: ${track.label}`);
          };
        });
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      chunkIndexRef.current = 0;

      // Handle data available (chunks)
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log(`MediaRecorder ondataavailable fired: ${event.data.size} bytes, recordingMode: ${recordingMode}`);
          audioChunksRef.current.push(event.data);
          
          // Send chunk to server when we have data (only if not paused)
          // MediaRecorder fires this event every 30 seconds based on start(30000)
          // Use ref to check pause state to avoid closure issues
          if (!isPausedRef.current && audioChunksRef.current.length > 0) {
            const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            const arrayBuffer = await blob.arrayBuffer();

            const chunkIndex = chunkIndexRef.current++;
            const chunkSize = arrayBuffer.byteLength;
            console.log(`[TAB MODE] Sending audio chunk ${chunkIndex} to server (size: ${chunkSize} bytes)`);

            socketRef.current.emit("audio:chunk", {
              sessionId: sessionIdRef.current, // Use ref to get current sessionId
              audioData: Array.from(new Uint8Array(arrayBuffer)),
              chunkIndex,
              timestamp: Date.now(),
            });

            console.log(`✓ [TAB MODE] Audio chunk ${chunkIndex} sent (${chunkSize} bytes) - server will transcribe via Gemini Live API`);

            // Clear chunks for next interval
            audioChunksRef.current = [];
          } else {
            console.log(`[TAB MODE] Skipping chunk send - paused: ${isPausedRef.current}, chunks: ${audioChunksRef.current.length}`);
          }
        } else {
          console.warn(`[TAB MODE] MediaRecorder ondataavailable fired with empty data`);
        }
      };

      // Handle pause event
      mediaRecorder.onpause = () => {
        console.log("MediaRecorder paused - state:", mediaRecorder.state);
        isPausedRef.current = true;
        setIsPaused(true);
      };

      // Handle resume event
      mediaRecorder.onresume = () => {
        console.log("MediaRecorder resumed - state:", mediaRecorder.state);
        isPausedRef.current = false;
        setIsPaused(false);
      };

      // Handle stop event
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped - state:", mediaRecorder.state);
        isPausedRef.current = false;
        setIsPaused(false);
        // Don't reset isRecording here - let stopRecording handle it
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        const err = new Error("MediaRecorder error");
        setError(err);
        onError?.(err);
      };

      // Monitor stream tracks to detect if they're stopped unexpectedly
      // Only log errors if recording is actually active
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          // Only warn if we're actually recording and this is unexpected
          if (isRecordingRef.current && mediaRecorderRef.current && 
              (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused")) {
            console.warn(`Audio track ended: ${track.label} (this may stop MediaRecorder)`);
            // Don't log as error - this might be expected behavior
          }
        };
      });

      // Verify stream is still active before starting
      const activeTracks = stream.getTracks().filter(t => t.readyState === "live");
      if (activeTracks.length === 0) {
        throw new Error("No active audio tracks available");
      }

      console.log(`Starting MediaRecorder with ${activeTracks.length} active track(s)`);

      // Set recording state FIRST so Web Speech API can start immediately
      isPausedRef.current = false;
      isRecordingRef.current = true; // Set ref FIRST
      setIsRecording(true);
      setIsPaused(false);

      // Start Web Speech API recognition IMMEDIATELY (before MediaRecorder)
      // ONLY for MIC mode - Web Speech API can't transcribe tab audio
      if (recordingMode === "MIC" && speechRecognitionRef.current) {
        try {
          // Start recognition IMMEDIATELY for instant transcription
          speechRecognitionRef.current.start();
          console.log("✓ Web Speech API started IMMEDIATELY (FREE transcription for microphone)");
        } catch (error) {
          console.warn("Could not start Web Speech API immediately:", error);
          // Will retry after MediaRecorder starts
        }
      } else if (recordingMode === "TAB") {
        console.log("TAB mode: Using server-side transcription from MediaRecorder chunks");
      }

      // Start recording with smaller chunks for TAB mode to get faster transcription
      // Use 5-second chunks for TAB mode to get faster feedback (30 seconds for MIC mode)
      const chunkInterval = recordingMode === "TAB" ? 5000 : 30000; // 5 seconds for TAB, 30 for MIC
      mediaRecorder.start(chunkInterval);
      console.log(`[TAB MODE] MediaRecorder started with ${chunkInterval/1000}s chunks - first chunk will be sent in ${chunkInterval/1000} seconds`);

      // Wait a bit to ensure MediaRecorder is actually recording
      // Check state multiple times as it may take a moment to transition
      let attempts = 0;
      while (mediaRecorder.state !== "recording" && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        attempts++;
      }

      // Verify MediaRecorder is in recording state
      if (mediaRecorder.state !== "recording") {
        console.error(`MediaRecorder failed to start. State: ${mediaRecorder.state}, attempts: ${attempts}`);
        // Check if tracks are still active
        const stillActiveTracks = stream.getTracks().filter(t => t.readyState === "live");
        console.error(`Active tracks after failed start: ${stillActiveTracks.length}`);
        throw new Error(`Failed to start MediaRecorder. State: ${mediaRecorder.state}`);
      }

      console.log(`MediaRecorder started successfully. State: ${mediaRecorder.state}, Stream active: ${stream.active}`);
      
      // Retry Web Speech API if it didn't start earlier (shouldn't happen, but safety net)
      // ONLY for MIC mode - Web Speech API can't transcribe tab audio
      if (recordingMode === "MIC" && speechRecognitionRef.current) {
        try {
          // Check if already started by trying to start again (will throw if already started)
          speechRecognitionRef.current.start();
          console.log("✓ Web Speech API started (retry after MediaRecorder)");
        } catch (error: any) {
          // If error is "already started", that's fine - it means it started earlier
          if (error?.message?.includes("already") || error?.name === "InvalidStateError") {
            console.log("✓ Web Speech API already running (started earlier)");
          } else {
            console.warn("Could not start Web Speech API:", error);
          }
        }
      } else if (recordingMode === "TAB") {
        console.log("TAB mode: Server-side transcription will process MediaRecorder chunks");
      }
      
      // Monitor stream health periodically
      // Health check - only log warnings, not errors (tracks ending might be expected)
      const healthCheck = setInterval(() => {
        if (!isRecordingRef.current) {
          clearInterval(healthCheck);
          return;
        }
        
        if (!stream.active) {
          console.warn("Stream became inactive");
          clearInterval(healthCheck);
          return;
        }
        
        const activeTracks = stream.getTracks().filter(t => t.readyState === "live");
        if (activeTracks.length === 0 && isRecordingRef.current) {
          // Only warn if we're still supposed to be recording
          console.warn("All tracks ended - recording may stop");
          clearInterval(healthCheck);
          return;
        }
        
        if (mediaRecorder.state === "inactive" && isRecordingRef.current) {
          console.warn("MediaRecorder became inactive unexpectedly");
          clearInterval(healthCheck);
        }
      }, 1000);

      // Store interval for cleanup
      chunkIntervalRef.current = healthCheck as unknown as NodeJS.Timeout;

      // Notify server
      socketRef.current.emit("session:start", {
        sessionId: sessionIdRef.current, // Use ref to get current sessionId
        userId,
        recordingMode,
      });
    } catch (err) {
      // Only handle errors that weren't already handled in the inner catch blocks
      // Cancellation and other tab sharing errors are already handled above
      const error = err instanceof Error ? err : new Error("Failed to start recording");
      
      // Check if this is a cancellation error that was already handled
      // Don't re-handle or log cancellation errors
      if (error.message.includes("cancelled") || 
          error.name === "NotAllowedError" || 
          error.name === "AbortError" ||
          (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError"))) {
        // Already handled above, just ensure state is correct
        setIsRecording(false);
        isRecordingRef.current = false;
        return;
      }
      
      // For other unexpected errors, set error state
      setError(error);
      onError?.(error);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [userId, recordingMode, onError]); // Removed sessionId from deps - using ref instead

  const pauseRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    
    if (!recorder) {
      console.warn("Cannot pause: MediaRecorder is null");
      return;
    }

    if (!isRecording) {
      console.warn("Cannot pause: Not recording");
      return;
    }

    if (isPaused) {
      console.warn("Cannot pause: Already paused");
      return;
    }

    try {
      const state = recorder.state;
      console.log("MediaRecorder state before pause:", state, "isRecording:", isRecording);
      
      // Check if pause is supported
      if (typeof recorder.pause !== "function") {
        console.warn("MediaRecorder.pause() is not supported in this browser");
        // Fallback: just update UI state
        isPausedRef.current = true;
        setIsPaused(true);
        socketRef.current.emit("session:pause", { sessionId: sessionIdRef.current });
        return;
      }
      
      if (state === "recording") {
        recorder.pause();
        isPausedRef.current = true;
        setIsPaused(true);
        socketRef.current.emit("session:pause", { sessionId: sessionIdRef.current });
        console.log("Pause command sent, new state:", recorder.state);
      } else if (state === "paused") {
        console.warn("Already paused");
        isPausedRef.current = true;
        setIsPaused(true);
      } else {
        console.warn(`Cannot pause: MediaRecorder state is "${state}" (expected "recording" or "paused")`);
        // Fallback: update UI state anyway for better UX
        isPausedRef.current = true;
        setIsPaused(true);
        socketRef.current.emit("session:pause", { sessionId: sessionIdRef.current });
      }
    } catch (error) {
      console.error("Error pausing recording:", error);
      // Fallback: update state anyway
      isPausedRef.current = true;
      setIsPaused(true);
      socketRef.current.emit("session:pause", { sessionId });
      setError(error instanceof Error ? error : new Error("Failed to pause recording"));
    }
  }, [isRecording, isPaused]); // Removed sessionId from deps - using ref instead

  const resumeRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    
    if (!recorder) {
      console.warn("Cannot resume: MediaRecorder is null");
      return;
    }

    if (!isRecording) {
      console.warn("Cannot resume: Not recording");
      return;
    }

    if (!isPaused) {
      console.warn("Cannot resume: Not paused");
      return;
    }

    try {
      const state = recorder.state;
      console.log("MediaRecorder state before resume:", state, "isPaused:", isPaused);
      
      // Check if resume is supported
      if (typeof recorder.resume !== "function") {
        console.warn("MediaRecorder.resume() is not supported in this browser");
        // Fallback: just update UI state
        isPausedRef.current = false;
        setIsPaused(false);
        socketRef.current.emit("session:resume", { sessionId: sessionIdRef.current });
        return;
      }
      
      if (state === "paused") {
        recorder.resume();
        isPausedRef.current = false;
        setIsPaused(false);
        socketRef.current.emit("session:resume", { sessionId: sessionIdRef.current });
        console.log("Resume command sent, new state:", recorder.state);
      } else if (state === "recording") {
        console.warn("Already recording");
        isPausedRef.current = false;
        setIsPaused(false);
      } else {
        console.warn(`Cannot resume: MediaRecorder state is "${state}" (expected "paused" or "recording")`);
        // Fallback: update UI state anyway for better UX
        isPausedRef.current = false;
        setIsPaused(false);
        socketRef.current.emit("session:resume", { sessionId: sessionIdRef.current });
      }
    } catch (error) {
      console.error("Error resuming recording:", error);
      // Fallback: update state anyway
      isPausedRef.current = false;
      setIsPaused(false);
      socketRef.current.emit("session:resume", { sessionId });
      setError(error instanceof Error ? error : new Error("Failed to resume recording"));
    }
  }, [isRecording, isPaused]); // Removed sessionId from deps - using ref instead

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && isRecording) {
      // Stop Web Speech API and send any remaining transcripts FIRST
      if (speechRecognitionRef.current) {
        try {
          // Send any remaining transcript buffer BEFORE stopping
          if (transcriptBufferRef.current.trim()) {
            const chunkIndex = transcriptChunkIndexRef.current++;
            const finalTranscript = transcriptBufferRef.current.trim();
            console.log(`Sending final transcript chunk ${chunkIndex}: "${finalTranscript.substring(0, 50)}..."`);
            
            socketRef.current.emit("transcript:chunk", {
              sessionId: sessionIdRef.current,
              transcript: finalTranscript,
              chunkIndex,
              timestamp: Date.now(),
            });
            onTranscriptUpdate?.(finalTranscript, chunkIndex);
            transcriptBufferRef.current = "";
          }
          
          // Wait a bit for the transcript to be sent, then stop
          await new Promise(resolve => setTimeout(resolve, 200));
          
          speechRecognitionRef.current.stop();
          speechRecognitionRef.current.abort();
          console.log("Web Speech API stopped");
        } catch (error) {
          console.warn("Error stopping speech recognition:", error);
        }
      }

      // Stop MediaRecorder only if it's recording or paused
      if (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.stop();
      }
      
      // Send any remaining audio chunks
      if (audioChunksRef.current.length > 0) {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        
        socketRef.current.emit("audio:chunk", {
          sessionId: sessionIdRef.current,
          audioData: Array.from(new Uint8Array(arrayBuffer)),
          chunkIndex: chunkIndexRef.current++,
          timestamp: Date.now(),
        });
      }

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      // Notify server
      socketRef.current.emit("session:stop", { sessionId: sessionIdRef.current });

      // Clear interval
      if (chunkIntervalRef.current) {
        clearInterval(chunkIntervalRef.current);
        chunkIntervalRef.current = null;
      }

      isPausedRef.current = false;
      isRecordingRef.current = false; // Add this
      setIsRecording(false);
      setIsPaused(false);
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      transcriptBufferRef.current = "";
    }
  }, [isRecording, onTranscriptUpdate]); // Added onTranscriptUpdate to deps

  // Cleanup on unmount only (not when isRecording changes)
  useEffect(() => {
    return () => {
      // Only cleanup on component unmount
      console.log("useRecording cleanup - stopping recording and tracks");
      if (mediaRecorderRef.current && (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused")) {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error("Error stopping MediaRecorder in cleanup:", e);
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          if (track.readyState === "live") {
            track.stop();
          }
        });
        streamRef.current = null;
      }
    };
    // Empty dependency array - only run on unmount
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isRecording,
    isPaused,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearError,
  };
}


