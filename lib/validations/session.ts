import { z } from "zod";
import { RecordingMode, SessionStatus } from "@prisma/client";

// Create Session Schema
export const createSessionSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters").optional(),
  recordingMode: z.nativeEnum(RecordingMode),
  userId: z.string().min(1, "User ID is required"),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// Update Session Schema
export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.nativeEnum(SessionStatus).optional(),
  duration: z.number().int().nonnegative().optional(),
  transcript: z.string().optional(),
  summary: z.string().optional(),
  pausedAt: z.date().nullable().optional(),
  stoppedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
});

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

// Create Transcript Chunk Schema
export const createTranscriptChunkSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  chunkIndex: z.number().int().nonnegative(),
  transcript: z.string().min(1, "Transcript is required"),
  startTime: z.number().int().nonnegative(),
  endTime: z.number().int().nonnegative(),
});

export type CreateTranscriptChunkInput = z.infer<typeof createTranscriptChunkSchema>;

