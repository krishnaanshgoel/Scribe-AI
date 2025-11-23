"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { useRecording } from "@/hooks/use-recording";
import { getSocket } from "@/lib/socket-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic, Monitor, Play, Pause, Square, Radio, AlertCircle } from "lucide-react";
import type { RecordingMode } from "@/lib/types";
import { createSessionSchema } from "@/lib/validations/session";  // Removed unused import

export default function Dashboard() {
  const router = useRouter();
  const { data: session } = useSession();
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("MIC");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [transcriptChunks, setTranscriptChunks] = useState<Array<{ index: number; text: string; timestamp: number }>>([]);
  const [audioChunksSent, setAudioChunksSent] = useState<number>(0);
  const [lastChunkTime, setLastChunkTime] = useState<Date | null>(null);
  const [chunksToShow, setChunksToShow] = useState<number>(3); // Show 3 chunks initially

  const {
    isRecording,
    isPaused,
    error: recordingError,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearError,
  } = useRecording({
    sessionId: sessionId || "",
    userId: session?.user?.id || "",
    recordingMode,
    onTranscriptUpdate: (transcriptText, chunkIndex) => {
      // Filter out placeholder messages more strictly
      const isPlaceholder = transcriptText.includes("Transcription via Web Speech API") ||
                           transcriptText.includes("Audio chunk") ||
                           transcriptText.includes("recorded from") ||
                           /\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g.test(transcriptText);
      
      if (isPlaceholder) {
        console.log(`[UI FILTER] Skipping placeholder message for chunk ${chunkIndex}`);
        return; // Don't display placeholder messages
      }
      
      const timestamp = Date.now();
      // Use unique key combining chunkIndex and timestamp to avoid duplicates
      setTranscriptChunks((prev) => {
        // Check if this chunk index already exists, update it instead of adding duplicate
        const existingIndex = prev.findIndex((chunk) => chunk.index === chunkIndex);
        if (existingIndex >= 0) {
          // Update existing chunk - replace with new text for live updates
          // This allows interim transcripts to update in real-time
          const updated = [...prev];
          const existingText = updated[existingIndex].text;
          
          // Only update if text is actually different (avoid unnecessary re-renders)
          // For interim results, they will be different as user speaks
          // For final results, they should replace interim
          if (transcriptText.trim() !== existingText.trim() && transcriptText.trim().length > 0) {
            updated[existingIndex] = { 
              index: chunkIndex, 
              text: transcriptText, // Replace with latest (interim or final)
              timestamp 
            };
            return updated;
          }
          return prev; // No change, return previous state
        } else {
          // Add new chunk (this creates chunk 0, 1, 2, etc. as they appear)
          // Only add if transcriptText is not empty
          if (transcriptText.trim().length > 0) {
            return [...prev, { index: chunkIndex, text: transcriptText, timestamp }];
          }
          return prev;
        }
      });
      // Don't accumulate transcript for full display during recording
      // This avoids duplicates - the session transcript in DB will have the full transcript
      // We only show individual chunks during recording
    },
    onError: (error) => {
      // Don't log cancellation errors - they're expected behavior
      if (!error.message.includes("cancelled")) {
        console.error("Recording error:", error);
      }
    },
  });

  const handleStartRecording = async () => {
    if (!session?.user?.id) {
      alert("Please sign in to start recording");
      return;
    }

    try {
      // Create session in database
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recordingMode,
          title: `Recording - ${new Date().toLocaleString()}`,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create session");
      }

      const data = await response.json();
      const newSessionId = data.session.id;
      
      if (!newSessionId) {
        throw new Error("Failed to get session ID from server");
      }
      
      // Set sessionId state - this will update the ref in the hook via useEffect
      setSessionId(newSessionId);
      
      // Reset transcript state for new session
      setTranscript("");
      setTranscriptChunks([]);
      setAudioChunksSent(0);
      setLastChunkTime(null);
      setRecordingTime(0);
      
      // Wait a moment for React state and ref to update
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Start recording - sessionId will be available via ref in the hook
      // Note: Errors (including cancellation) are handled in the hook and displayed in the UI error card
      await startRecording();
    } catch (error) {
      // This catch block should rarely be hit now since errors are handled in the hook
      // But keep it as a safety net for unexpected errors
      console.error("Unexpected error starting recording:", error);
      
      // Reset sessionId so user can try again
      setSessionId(null);
      
      // Only show alert for truly unexpected errors (not cancellation)
      if (error instanceof Error && !error.message.includes("cancelled")) {
        alert(error.message || "Failed to start recording. Please try again.");
      }
    }
  };

  const handlePauseRecording = () => {
    pauseRecording();
  };

  const handleResumeRecording = () => {
    resumeRecording();
  };

  const handleStopRecording = async () => {
    if (!sessionId) return;

    try {
      // Stop recording first
      try {
        await stopRecording();
      } catch (error) {
        console.error("Error stopping recording hook:", error);
        // Continue anyway - we'll still try to update the session
      }

      // Stop session and trigger summary generation
      let response: Response;
      try {
        response = await fetch(`/api/sessions/${sessionId}/stop`, {
          method: "POST",
        });
      } catch (networkError) {
        // Network error (e.g., fetch failed)
        console.error("Network error stopping session:", networkError);
        throw new Error("Network error: Could not connect to server. Please check your connection and try again.");
      }

      if (!response.ok) {
        // Try to get error details from response
        let errorMessage = "Failed to stop session";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(`${errorMessage} (${response.status})`);
      }

      // Reset state
      setSessionId(null);
      setTranscript("");
      setTranscriptChunks([]);
      setAudioChunksSent(0);
      setLastChunkTime(null);
      setRecordingTime(0);

      // Redirect to sessions page
      router.push("/sessions");
      router.refresh();
    } catch (error) {
      console.error("Error stopping recording:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to stop recording. Please try again.";
      alert(errorMessage);
      // Don't reset state on error - allow user to retry
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Timer for recording duration
  const [recordingTime, setRecordingTime] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused]);

  // Listen for audio chunk events to track chunks being sent
  useEffect(() => {
    if (!isRecording) return;

    const socket = getSocket();

    const handleAudioReceived = (data: { chunkIndex: number; timestamp: number }) => {
      console.log(`Server received chunk ${data.chunkIndex}`);
      setAudioChunksSent((prev) => Math.max(prev, data.chunkIndex + 1));
      setLastChunkTime(new Date(data.timestamp));
    };

    socket.on("audio:received", handleAudioReceived);

    return () => {
      socket.off("audio:received", handleAudioReceived);
    };
  }, [isRecording]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Start a new transcription session or manage existing ones
        </p>
      </div>

      {/* Error Display */}
      {recordingError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <p className="text-sm">{recordingError.message}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Clear error and reset sessionId to allow retry
                  clearError();
                  setSessionId(null);
                }}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recording Control Card */}
      <Card>
        <CardHeader>
          <CardTitle>New Session</CardTitle>
          <CardDescription>
            Choose your recording source and start transcribing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs
            defaultValue="MIC"
            value={recordingMode}
            onValueChange={(value) => setRecordingMode(value as RecordingMode)}
            // Removed disabled prop - not needed for controlled component
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="MIC" className="gap-2">
                <Mic className="h-4 w-4" />
                Microphone
              </TabsTrigger>
              <TabsTrigger value="TAB" className="gap-2">
                <Monitor className="h-4 w-4" />
                Tab/Meeting Share
              </TabsTrigger>
            </TabsList>
            <TabsContent value="MIC" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Record audio directly from your microphone. Make sure to grant
                microphone permissions when prompted.
              </p>
            </TabsContent>
            <TabsContent value="TAB" className="space-y-4 mt-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Capture audio from a shared tab (e.g., Google Meet, Zoom, YouTube videos). You
                  will be prompted to select which tab to share.
                </p>
                <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg space-y-1">
                  <p className="font-semibold">Supported sources:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Google Meet, Zoom, Teams (web versions)</li>
                    <li>YouTube videos, podcasts, webinars</li>
                    <li>Any website with audio playback</li>
                  </ul>
                  <p className="font-semibold mt-2">Tips:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Select a browser tab (not entire screen) for best results</li>
                    <li>Ensure the meeting/tab has audio playing</li>
                    <li>Keep the shared tab active during recording</li>
                    <li>Don't stop sharing the tab while recording</li>
                  </ul>
                  <p className="text-xs mt-2 text-muted-foreground/80">
                    <strong>Note:</strong> Captures all audio from the tab. Multiple speakers are transcribed together (no speaker identification).
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Recording Status */}
          {isRecording && (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-destructive animate-pulse" />
                <span className="font-medium">
                  {isPaused ? "Paused" : "Recording"}
                </span>
              </div>
              <div className="flex-1" />
              <div className="text-2xl font-mono font-bold">
                {formatTime(recordingTime)}
              </div>
            </div>
          )}

          {/* Live Transcript & Status */}
          {isRecording && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Live Recording Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Audio Chunk Status */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-green-500 animate-pulse" />
                    <span className="text-sm font-medium">Audio Chunks Sent</span>
                  </div>
                  <div className="text-lg font-bold">{audioChunksSent}</div>
                </div>

                {/* Live Transcript Chunks */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Live Transcript Chunks</h4>
                    {transcriptChunks.length > chunksToShow && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setChunksToShow(3)}
                        className="text-xs h-7"
                      >
                        Show Less
                      </Button>
                    )}
                  </div>
                  {transcriptChunks.length > 0 ? (
                    <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                      {transcriptChunks
                        .sort((a, b) => a.index - b.index) // Sort by chunk index
                        .slice(0, chunksToShow) // Show only chunksToShow chunks
                        .map((chunk) => {
                          // Calculate exact 30-second intervals: chunk 0 = 0:00-0:30, chunk 1 = 0:30-1:00, etc.
                          const startTime = chunk.index * 30;
                          const endTime = startTime + 30;
                          const startMinutes = Math.floor(startTime / 60);
                          const startSeconds = startTime % 60;
                          const endMinutes = Math.floor(endTime / 60);
                          const endSeconds = endTime % 60;
                          
                          // Filter out placeholder messages
                          const displayText = chunk.text
                            .replace(/\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g, '')
                            .replace(/Transcription via Web Speech API/g, '')
                            .trim();
                          
                          if (!displayText) return null;
                          
                          return (
                            <div key={`${chunk.index}-${chunk.timestamp}`} className="border-b pb-2 last:border-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-muted-foreground">
                                  Chunk {chunk.index} • {startMinutes}:{startSeconds.toString().padStart(2, '0')} - {endMinutes}:{endSeconds.toString().padStart(2, '0')}
                                </span>
                                <span className="text-xs text-green-600 dark:text-green-400 animate-pulse">● Live</span>
                              </div>
                              <p className="text-sm whitespace-pre-wrap break-words">
                                {displayText}
                              </p>
                            </div>
                          );
                        })}
                      {transcriptChunks.length > chunksToShow && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChunksToShow(prev => Math.min(prev + 10, transcriptChunks.length))}
                          className="w-full mt-2"
                        >
                          Read More ({transcriptChunks.length - chunksToShow} more chunks)
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg p-3 bg-muted/30">
                      <Radio className="h-8 w-8 mx-auto mb-2 text-muted-foreground animate-pulse" />
                      <p>Waiting for transcription...</p>
                      <p className="text-xs mt-1">Speak to see live transcript</p>
                    </div>
                  )}
                </div>

                {/* Full Transcript Preview - Removed during recording to avoid duplicates */}
                {/* Show only after recording stops */}

                {/* No chunks yet */}
                {transcriptChunks.length === 0 && (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    <Radio className="h-8 w-8 mx-auto mb-2 text-muted-foreground animate-pulse" />
                    <p>Waiting for audio chunks...</p>
                    <p className="text-xs mt-1">Audio chunks are sent every 30 seconds</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Control Buttons */}
          <div className="flex gap-3">
            {!isRecording ? (
              <Button
                size="lg"
                onClick={handleStartRecording}
                className="gap-2"
                disabled={!session?.user}
              >
                <Play className="h-5 w-5" />
                Start Session
              </Button>
            ) : (
              <>
                {isPaused ? (
                  <Button
                    size="lg"
                    variant="default"
                    onClick={handleResumeRecording}
                    className="gap-2"
                  >
                    <Play className="h-5 w-5" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={handlePauseRecording}
                    className="gap-2"
                  >
                    <Pause className="h-5 w-5" />
                    Pause
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleStopRecording}
                  className="gap-2"
                >
                  <Square className="h-5 w-5" />
                  Stop & Process
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Sessions
            </CardTitle>
            <Mic className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              No sessions yet
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Duration
            </CardTitle>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0h 0m</div>
            <p className="text-xs text-muted-foreground">
              Start recording to track time
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Last Session
            </CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">
              No recent sessions
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
