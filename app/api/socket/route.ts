// This route is handled by the Socket.io server in server/index.ts
// It's kept here for Next.js routing compatibility
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ 
    message: "Socket.io endpoint - WebSocket connections are handled by the Socket.io server" 
  });
}
