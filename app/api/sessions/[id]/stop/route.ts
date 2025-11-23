import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateSessionSummary } from "@/server/services/transcription";

// POST /api/sessions/[id]/stop - Stop session and generate summary
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let id: string;
    try {
      const resolvedParams = await params;
      id = resolvedParams.id;
      
      if (!id) {
        return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
      }
    } catch (error) {
      console.error("Error resolving params:", error);
      return NextResponse.json(
        { error: "Invalid session ID parameter" },
        { status: 400 }
      );
    }

    // Check if session exists and user owns it
    let existingSession;
    try {
      existingSession = await prisma.appSession.findUnique({
        where: { id },
      });
    } catch (error) {
      console.error("Database error fetching session:", error);
      return NextResponse.json(
        { error: "Database error while fetching session" },
        { status: 500 }
      );
    }

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (existingSession.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update session status to PROCESSING
    try {
      await prisma.appSession.update({
        where: { id },
        data: {
          status: "PROCESSING",
          stoppedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Database error updating session:", error);
      return NextResponse.json(
        { error: "Failed to update session status" },
        { status: 500 }
      );
    }

    // Generate summary in background (don't wait for it)
    generateSessionSummary(id).catch((error) => {
      console.error("Error generating summary:", error);
    });

    return NextResponse.json({
      success: true,
      message: "Session stopped. Summary generation started.",
    });
  } catch (error) {
    console.error("Error stopping session:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to stop session: ${errorMessage}` },
      { status: 500 }
    );
  }
}

