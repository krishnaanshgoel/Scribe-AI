"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download, Trash2, Clock, Calendar, Loader2 } from "lucide-react";
import { formatDateToIST, formatDuration } from "@/lib/utils";
import { SessionStatus } from "@/lib/types";

interface Session {
  id: string;
  title: string;
  duration: number;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  transcript: string | null;
  summary: string | null;
  transcriptChunks: Array<{
    id: string;
    transcript: string;
    startTime: number;
    endTime: number;
    chunkIndex: number;
  }>;
}

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chunksToShow, setChunksToShow] = useState<number>(3); // Show 3 chunks initially

  useEffect(() => {
    if (sessionId) {
      fetchSession();
    }
  }, [sessionId]);

  const fetchSession = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/sessions/${sessionId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Session not found");
        }
        throw new Error("Failed to fetch session");
      }
      
      const data = await response.json();
      setSession(data.session);
    } catch (err) {
      console.error("Error fetching session:", err);
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTranscript = async () => {
    if (!session?.transcript) {
      alert("No transcript available");
      return;
    }

    try {
      const blob = new Blob([session.transcript], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transcript-${session.id}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading transcript:", err);
      alert("Failed to download transcript");
    }
  };

  const handleDeleteSession = async () => {
    if (!confirm("Are you sure you want to delete this session?")) {
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete session");
      }

      router.push("/sessions");
    } catch (err) {
      console.error("Error deleting session:", err);
      alert("Failed to delete session");
    }
  };

  const getStatusBadge = (status: SessionStatus) => {
    const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
      RECORDING: {
        label: "Recording",
        className: "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20",
      },
      PAUSED: {
        label: "Paused",
        className: "bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400 border-yellow-500/20",
      },
      PROCESSING: {
        label: "Processing",
        className: "bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400 border-orange-500/20",
      },
      COMPLETED: {
        label: "Completed",
        className: "bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-green-500/20",
      },
      FAILED: {
        label: "Failed",
        className: "bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-500/20",
      },
    };

    const config = statusConfig[status] || statusConfig.PROCESSING;
    return (
      <Badge variant="secondary" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">Loading session...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-destructive mb-4">{error || "Session not found"}</p>
            <div className="flex gap-2">
              <Button onClick={fetchSession}>Retry</Button>
              <Button variant="outline" onClick={() => router.push("/sessions")}>
                Go to Sessions
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex gap-2">
          {session.transcript && (
            <Button variant="outline" onClick={handleDownloadTranscript} className="gap-2">
              <Download className="h-4 w-4" />
              Download
            </Button>
          )}
          <Button variant="destructive" onClick={handleDeleteSession} className="gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2">{session.title}</CardTitle>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDateToIST(session.createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {formatDuration(session.duration)}
                </span>
                {getStatusBadge(session.status)}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {session.summary && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Summary</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {session.summary}
              </p>
            </div>
          )}

          {session.transcriptChunks && session.transcriptChunks.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold">Transcript Chunks</h3>
                {session.transcriptChunks.length > chunksToShow && (
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
              <div className="space-y-4">
                {session.transcriptChunks
                  .sort((a, b) => a.chunkIndex - b.chunkIndex) // Sort by chunk index
                  .slice(0, chunksToShow) // Show only chunksToShow chunks
                  .map((chunk) => {
                    // Filter out placeholder messages
                    const cleanedText = chunk.transcript
                      .replace(/\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g, '')
                      .replace(/Transcription via Web Speech API/g, '')
                      .trim();
                    
                    if (!cleanedText) return null;
                    
                    return (
                      <div key={chunk.id} className="border rounded-lg p-4">
                        <div className="text-xs text-muted-foreground mb-2">
                          Chunk {chunk.chunkIndex} • {formatDuration(chunk.startTime)} - {formatDuration(chunk.endTime)}
                        </div>
                        <p className="text-sm">{cleanedText}</p>
                      </div>
                    );
                  })}
                {session.transcriptChunks.length > chunksToShow && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChunksToShow(prev => Math.min(prev + 10, session.transcriptChunks.length))}
                    className="w-full"
                  >
                    Read More ({session.transcriptChunks.length - chunksToShow} more chunks)
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Full Transcript - Combine all chunks */}
          {session.transcriptChunks && session.transcriptChunks.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Full Transcript</h3>
              <div className="border rounded-lg p-4 bg-muted/50">
                <p className="text-sm whitespace-pre-wrap">
                  {session.transcriptChunks
                    .sort((a, b) => a.chunkIndex - b.chunkIndex) // Sort by chunk index (0, 1, 2, ...)
                    .map((chunk) => {
                      // Filter out placeholder messages
                      const cleanedText = chunk.transcript
                        .replace(/\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g, '')
                        .replace(/Transcription via Web Speech API/g, '')
                        .trim();
                      return cleanedText;
                    })
                    .filter(text => text.length > 0) // Remove empty chunks
                    .join(' ') // Combine all chunks into one paragraph
                  }
                </p>
              </div>
            </div>
          )}
          {/* Fallback to session.transcript if no chunks available */}
          {(!session.transcriptChunks || session.transcriptChunks.length === 0) && session.transcript && (
            <div>
              <h3 className="text-lg font-semibold mb-2">Full Transcript</h3>
              <div className="border rounded-lg p-4 bg-muted/50">
                <p className="text-sm whitespace-pre-wrap">
                  {session.transcript
                    // Remove time range markers like [60s - 90s]
                    .replace(/\[\d+s - \d+s\]/g, '')
                    // Remove placeholder messages
                    .replace(/\[Audio chunk \d+ recorded from \d+s to \d+s\. Transcription via Web Speech API\.\]/g, '')
                    .replace(/Transcription via Web Speech API/g, '')
                    // Clean up multiple newlines
                    .replace(/\n{3,}/g, '\n\n')
                    .trim()
                  }
                </p>
              </div>
            </div>
          )}

          {!session.transcript && session.status === "PROCESSING" && (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Processing transcript...</p>
            </div>
          )}

          {!session.transcript && session.status !== "PROCESSING" && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No transcript available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

