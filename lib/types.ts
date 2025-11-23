import { z } from "zod";
import { AppSession, User, TranscriptChunk, RecordingMode, SessionStatus } from "@prisma/client";
import { 
  createSessionSchema, 
  updateSessionSchema, 
  createTranscriptChunkSchema 
} from "./validations/session";

// Extended types for API responses
export type SessionWithUser = AppSession & {
  user: User;
};

export type SessionWithChunks = AppSession & {
  transcriptChunks: TranscriptChunk[];
};

export type FullSession = AppSession & {
  user: User;
  transcriptChunks: TranscriptChunk[];
};

// API Response types (re-exported from validations for convenience)
export type { CreateSessionInput, UpdateSessionInput, CreateTranscriptChunkInput } from "./validations/session";

// Re-export Prisma types
export type { AppSession as Session, User, TranscriptChunk, RecordingMode, SessionStatus };
