"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Trash2, Eye, Clock, Calendar, Loader2, RefreshCw } from "lucide-react";
import { formatDateToIST, formatDuration } from "@/lib/utils";
import { SessionStatus } from "@/lib/types";
import { useRouter } from "next/navigation";

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
  }>;
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null); // Clear any previous errors
      
      const response = await fetch("/api/sessions");
      
      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = "Failed to fetch sessions";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      // Handle empty or invalid response
      if (!data || !Array.isArray(data.sessions)) {
        console.warn("Invalid response format:", data);
        setSessions([]);
        return;
      }
      
      // Set sessions (empty array is valid - means no sessions yet)
      setSessions(data.sessions);
    } catch (err) {
      console.error("Error fetching sessions:", err);
      const errorMessage = err instanceof Error 
        ? err.message 
        : "Failed to load sessions. Please try again.";
      setError(errorMessage);
      // Set empty array on error to prevent UI issues
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewSession = (id: string) => {
    router.push(`/sessions/${id}`);
  };

  const handleDownloadTranscript = async (id: string) => {
    try {
      const response = await fetch(`/api/sessions/${id}`);
      if (!response.ok) throw new Error("Failed to fetch session");
      
      const data = await response.json();
      const transcript = data.session.transcript || "No transcript available";
      
      // Create and download file
      const blob = new Blob([transcript], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transcript-${id}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading transcript:", err);
      alert("Failed to download transcript");
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm("Are you sure you want to delete this session?")) {
      return;
    }

    try {
      const response = await fetch(`/api/sessions/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete session");
      }

      // Remove from list
      setSessions((prev) => prev.filter((s) => s.id !== id));
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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground">
            View and manage your transcription sessions
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground">
            View and manage your transcription sessions
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-destructive mb-4">{error}</p>
            <Button onClick={fetchSessions}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="text-muted-foreground">
            View and manage your transcription sessions
          </p>
        </div>
        <Button variant="outline" onClick={fetchSessions} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sessions yet</h3>
            <p className="text-sm text-muted-foreground text-center mb-4">
              Start your first transcription session from the dashboard
            </p>
            <Button asChild>
              <a href="/dashboard">Go to Dashboard</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => {
            const transcriptPreview = session.transcript
              ? session.transcript.substring(0, 150) + (session.transcript.length > 150 ? "..." : "")
              : "No transcript available yet";

            return (
              <Card key={session.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-2">{session.title}</CardTitle>
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
                <CardContent>
                  <div className="space-y-4">
                    {session.summary && (
                      <div>
                        <h4 className="text-sm font-semibold mb-1">Summary</h4>
                        <p className="text-sm text-muted-foreground">
                          {session.summary}
                        </p>
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-semibold mb-1">Preview</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {transcriptPreview}
                      </p>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewSession(session.id)}
                        className="gap-2"
                      >
                        <Eye className="h-4 w-4" />
                        View
                      </Button>
                      {session.status === "COMPLETED" && session.transcript && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownloadTranscript(session.id)}
                          className="gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteSession(session.id)}
                        className="gap-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
