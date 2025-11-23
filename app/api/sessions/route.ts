import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSessionSchema, updateSessionSchema } from "@/lib/validations/session";
import { RecordingMode, SessionStatus } from "@prisma/client";

// GET /api/sessions - Get all sessions for current user
export async function GET(request: NextRequest) {
  try {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await prisma.appSession.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        transcriptChunks: {
          orderBy: {
            chunkIndex: "asc",
          },
        },
      },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

// POST /api/sessions - Create a new session
export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = createSessionSchema.parse({
      ...body,
      userId: session.user.id,
    });

    const newSession = await prisma.appSession.create({
      data: {
        title: validatedData.title || "Untitled Session",
        userId: validatedData.userId,
        recordingMode: validatedData.recordingMode,
        status: "RECORDING",
        startedAt: new Date(),
      },
    });

    return NextResponse.json({ session: newSession }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating session:", error);
    
    if (error.name === "ZodError") {
      return NextResponse.json(
        { error: "Invalid input", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

