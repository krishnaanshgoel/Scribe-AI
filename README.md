# ScribeAI - AI-Powered Audio Scribing and Meeting Transcription App

📹 **[Watch Demo Video](https://youtu.be/emZ5RCFkR3o)**

> **A real-time audio transcription tool** that captures and scribes audio from direct microphone input or shared meeting tabs (Google Meet/Zoom), streams to Gemini for live transcription, and stores sessions in PostgreSQL.

[![Next.js](https://img.shields.io/badge/Next.js-14+-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue)](https://www.postgresql.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.7+-green)](https://socket.io/)

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Setup Guide](#setup-guide)
- [Architecture Decisions](#architecture-decisions)
- [Long-Session Scalability](#long-session-scalability)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

ScribeAI is a full-stack productivity tool designed for professionals who need to convert raw audio into searchable, summarized transcripts. Perfect for meetings where manual note-taking falls short, the application handles:

- **Real-time audio capture** from microphone or browser tabs (Google Meet, Zoom, Teams)
- **Live transcription** with incremental updates via WebSocket
- **Long-duration sessions** (1+ hours) with chunked streaming
- **AI-powered summaries** with key points, action items, and decisions
- **Seamless state management** (Recording → Paused → Processing → Completed)

### Core Flow

```
Authenticate → Start Recording (Mic/Tab) → Stream/Transcribe Live → 
Pause/Resume → Stop → Process Summary → View/Export Transcript
```

## ✨ Key Features

### 🎤 Audio Capture
- **Microphone Recording**: Direct audio input from device microphone
- **Tab/Meeting Share**: Capture audio from Google Meet, Zoom, Teams, YouTube, and any browser tab
- **Browser Permissions**: Automatic handling of microphone and screen share permissions
- **Fallback Mechanisms**: Graceful degradation if tab share fails

### 📝 Real-Time Transcription
- **Live Updates**: Real-time transcript streaming via Socket.io
- **Chunked Processing**: 30-second audio chunks for efficient processing
- **Incremental Storage**: Transcript chunks stored incrementally in database
- **Multi-Speaker Support**: Captures audio from multiple participants (transcription aggregates all speakers)

### 🤖 AI-Powered Summaries
- **Key Points Extraction**: Identifies main discussion topics
- **Action Items**: Extracts tasks and assignments
- **Decisions Made**: Highlights important decisions
- **Deadlines & Dates**: Captures time-sensitive information

### 🔄 Session Management
- **State Machine**: Recording → Paused → Processing → Completed
- **Session History**: View and manage past sessions
- **Export Options**: Download transcripts and summaries
- **Duration Tracking**: Real-time session duration display

## 🏗️ Architecture

### System Architecture Flow

```mermaid
flowchart TB
    Browser[User Browser] -->|getUserMedia/getDisplayMedia| MediaRecorder[MediaRecorder API]
    MediaRecorder -->|30s Audio Chunks| WebSocketClient[WebSocket Client]
    WebSocketClient -->|Socket.io| NodeServer[Node.js Server]
    NodeServer -->|Audio Stream| GeminiLive[Gemini Live API]
    GeminiLive -->|Transcript| NodeServer
    NodeServer -->|Store Chunks| PostgreSQL[(PostgreSQL)]
    NodeServer -->|Emit Updates| WebSocketClient
    WebSocketClient -->|Live Transcript| Browser
    Browser -->|Stop Session| NodeServer
    NodeServer -->|Aggregate Transcript| GeminiSummary[Gemini Summary API]
    GeminiSummary -->|Summary| PostgreSQL
    PostgreSQL -->|Display| Browser
    
    style Browser fill:#e1f5ff
    style NodeServer fill:#fff4e1
    style PostgreSQL fill:#e8f5e9
    style GeminiLive fill:#fce4ec
    style GeminiSummary fill:#fce4ec
```

### Component Architecture

```
scribeai/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # Protected dashboard routes
│   │   ├── dashboard/           # Main recording interface
│   │   ├── sessions/            # Session history & details
│   │   └── settings/            # User settings
│   ├── (public)/                # Public routes
│   │   ├── sign-in/            # Authentication
│   │   └── sign-up/
│   └── api/                     # API Routes
│       ├── auth/                # Better Auth endpoints
│       ├── sessions/            # Session CRUD operations
│       └── socket/              # Socket.io route handler
├── server/                      # Node.js WebSocket Server
│   ├── index.ts                 # Main server (Next.js + Socket.io)
│   └── services/
│       ├── transcription.ts     # Audio processing service
│       ├── gemini-live.ts       # Gemini Live API integration
│       └── gemini-live-websocket.ts  # WebSocket-based streaming
├── hooks/                       # React Hooks
│   └── use-recording.ts         # Recording state management
├── lib/                         # Shared Libraries
│   ├── gemini.ts                # Gemini API client
│   ├── socket-client.ts         # Socket.io client wrapper
│   ├── transcription.ts         # Transcription utilities
│   └── validations/             # Zod schemas
├── components/                  # React Components
│   ├── ui/                      # shadcn/ui components
│   └── tab-audio-capture.tsx    # Tab audio capture component
└── prisma/                      # Database Schema
    └── schema.prisma            # Prisma schema definition
```

## 🛠️ Tech Stack

### Frontend
- **Next.js 14+** (App Router, TypeScript)
- **React 19** with Server Components
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **Socket.io Client** for real-time communication

### Backend
- **Node.js** with TypeScript
- **Next.js API Routes** for REST endpoints
- **Socket.io Server** for WebSocket communication
- **Prisma ORM** for database access

### Database
- **PostgreSQL** (via Supabase or self-hosted)
- **Prisma** for type-safe database queries

### Integrations
- **Google Gemini API** (Gemini 2.5 Flash) for transcription and summaries
- **Better Auth** for authentication
- **Web Speech API** (browser-based, free transcription for MIC mode)

### Development Tools
- **TypeScript** for type safety
- **ESLint** + **Prettier** for code quality
- **Zod** for runtime validation

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (Supabase recommended)
- Google Gemini API key ([Get one here](https://ai.google.dev/))

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd scribe_ai

# Install dependencies
npm install

# Set up environment variables (see Setup Guide)
cp .env.example .env
# Edit .env with your credentials

# Set up database
npm run db:generate
npm run db:push

# Start development server
npm run dev
```

The application will be available at `http://localhost:3000`.

## 📖 Setup Guide

### 1. Environment Variables

Create a `.env` file in the root directory:

```env
# Database (PostgreSQL)
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@YOUR_PROJECT_REF.supabase.co:5432/postgres?schema=public"

# Google Gemini API
GEMINI_API_KEY="your-gemini-api-key-here"

# Application URLs
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_SOCKET_URL="http://localhost:3000"

# Better Auth (optional)
BETTER_AUTH_SECRET="generate-random-string-here"
BETTER_AUTH_URL="http://localhost:3000"

# Node Environment
NODE_ENV="development"
```

#### Getting API Keys

**PostgreSQL Database (Supabase):**
1. Go to [supabase.com](https://supabase.com) and create a project
2. Navigate to **Settings** → **Database**
3. Copy the connection string from **Connection string** → **URI** tab
4. Replace `[YOUR-PASSWORD]` with your database password

**Google Gemini API:**
1. Visit [Google AI Studio](https://ai.google.dev/)
2. Sign in with your Google account
3. Click **"Get API Key"** or visit [API Keys page](https://aistudio.google.com/app/apikey)
4. Create a new API key and copy it

**Better Auth Secret:**
```bash
openssl rand -base64 32
```

### 2. Database Setup

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database
npm run db:push

# (Optional) Open Prisma Studio to view database
npm run db:studio
```

### 3. Start Development Server

```bash
# Start both Next.js and Socket.io server
npm run dev

# Or run separately:
npm run dev:next    # Next.js only
npm run dev         # Socket.io server + Next.js
```

### 4. Verify Setup

1. Open `http://localhost:3000`
2. Sign up or sign in
3. Navigate to Dashboard
4. Click "Start Session" and grant microphone permissions
5. Speak into your microphone to test transcription

## 🎯 Architecture Decisions

### Streaming vs. Upload Architecture Comparison

| Aspect | **Streaming (Chosen)** | **Upload (Alternative)** |
|--------|------------------------|--------------------------|
| **Latency** | Low (~1-2s per chunk) | High (30s+ delay) |
| **Memory Usage** | Low (processes chunks incrementally) | High (requires full file in memory) |
| **User Experience** | Real-time feedback, live transcript | Delayed results, no live updates |
| **Network Efficiency** | Continuous small transfers | Single large transfer |
| **Error Recovery** | Can recover mid-session | Must restart on failure |
| **Scalability** | Handles long sessions (1hr+) | Limited by file size limits |
| **Server Load** | Distributed over time | Peak load at upload |
| **Reliability** | Resilient to network drops | Single point of failure |

**Decision Rationale:** Streaming architecture was chosen because:
1. **Low Latency**: Users see transcripts in real-time, improving engagement
2. **Memory Efficiency**: Processes 30-second chunks instead of entire 1-hour recordings
3. **Better UX**: Live feedback allows users to adjust speaking or fix issues immediately
4. **Scalability**: Can handle sessions of any length without memory constraints
5. **Resilience**: Network interruptions only affect current chunk, not entire session

### Key Technical Decisions

#### 1. **Chunked Audio Processing (30-second intervals)**
- **Why**: Prevents memory overflow for long sessions (1+ hours)
- **Trade-off**: Slight overhead from chunk boundaries, but enables scalability
- **Implementation**: MediaRecorder API with `timeslice` parameter

#### 2. **Hybrid Transcription Approach**
- **MIC Mode**: Web Speech API (browser-based, free, real-time)
- **TAB Mode**: Gemini Live API (server-side, handles tab audio)
- **Why**: Web Speech API cannot access tab audio; Gemini provides accurate transcription

#### 3. **WebSocket over HTTP Polling**
- **Why**: Real-time bidirectional communication needed for live transcripts
- **Benefit**: Low latency, efficient for continuous data streams
- **Implementation**: Socket.io with automatic reconnection

#### 4. **Incremental Transcript Storage**
- **Why**: Enables resumable sessions and efficient querying
- **Structure**: `TranscriptChunk` table stores chunks with timestamps
- **Benefit**: Can reconstruct full transcript or query specific time ranges

#### 5. **Post-Processing Summary Generation**
- **Why**: Reduces API costs and improves summary quality
- **Timing**: Generated after session stop, not during recording
- **Model**: Gemini 2.5 Flash (fast, cost-effective)

#### 6. **State Machine for Session Management**
- **States**: `RECORDING` → `PAUSED` → `PROCESSING` → `COMPLETED` → `FAILED`
- **Why**: Clear state transitions prevent race conditions
- **Implementation**: Prisma enum with database-level constraints

## 📊 Long-Session Scalability

### Architecture for 1+ Hour Sessions

ScribeAI is architected to handle long-duration sessions (1 hour or more) through a combination of **chunked streaming**, **incremental storage**, and **efficient memory management**.

**Chunked Streaming Pipeline:**
The application processes audio in 30-second chunks rather than loading entire recordings into memory. Each chunk is:
1. Captured by MediaRecorder API with `timeslice: 30000`
2. Immediately sent to the server via WebSocket
3. Processed by Gemini API independently
4. Stored as a separate `TranscriptChunk` record in PostgreSQL
5. Emitted back to the client for live display

**Memory Optimization:**
- **Client-side**: Only current chunk held in memory (~500KB per chunk)
- **Server-side**: Processes one chunk at a time, releases memory after transcription
- **Database**: Incremental inserts prevent large transaction overhead

**Network Resilience:**
- Failed chunks are logged but don't stop the session
- WebSocket reconnection automatically resumes streaming
- Chunks include timestamps for gap detection and recovery

**Scalability Considerations:**
- **Concurrent Sessions**: Each session uses isolated WebSocket connections and database transactions
- **Database Performance**: Indexed queries on `sessionId` and `chunkIndex` enable fast retrieval
- **API Rate Limits**: 30-second chunks spread API calls over time (120 chunks/hour vs. 1 large request)
- **Storage**: Chunks stored incrementally prevent database bloat

**Production Recommendations:**
- Use connection pooling for PostgreSQL (Prisma handles this)
- Implement Redis for WebSocket session state (optional)
- Monitor Gemini API rate limits (60 req/min free tier)
- Consider horizontal scaling with load balancer for WebSocket connections

This architecture enables handling sessions of any length while maintaining low latency and efficient resource usage.

## 📡 API Documentation

### REST Endpoints

#### Sessions API

**GET `/api/sessions`**
- Get all sessions for authenticated user
- **Response**: `{ sessions: AppSession[] }`

**POST `/api/sessions`**
- Create new recording session
- **Body**: `{ title?: string, recordingMode: "MIC" | "TAB" }`
- **Response**: `{ session: AppSession }`

**GET `/api/sessions/[id]`**
- Get session with full transcript and chunks
- **Response**: `{ session: FullSession }`

**PATCH `/api/sessions/[id]`**
- Update session metadata
- **Body**: `{ title?, status?, duration?, ... }`
- **Response**: `{ session: AppSession }`

**DELETE `/api/sessions/[id]`**
- Delete session and all associated chunks
- **Response**: `{ success: true }`

**POST `/api/sessions/[id]/stop`**
- Stop recording and trigger summary generation
- **Response**: `{ success: true, message: string }`

### WebSocket Events

#### Client → Server

- `session:start` - Start new recording session
  ```typescript
  { sessionId: string, userId: string, recordingMode: "MIC" | "TAB" }
  ```

- `audio:chunk` - Send audio chunk for processing
  ```typescript
  { sessionId: string, chunkIndex: number, audioData: Buffer, startTime: number, endTime: number }
  ```

- `session:pause` - Pause recording
  ```typescript
  { sessionId: string }
  ```

- `session:resume` - Resume recording
  ```typescript
  { sessionId: string }
  ```

- `session:stop` - Stop recording
  ```typescript
  { sessionId: string }
  ```

#### Server → Client

- `session:started` - Session started confirmation
- `audio:received` - Audio chunk received acknowledgment
- `transcript:updated` - New transcript chunk available
  ```typescript
  { sessionId: string, chunkIndex: number, transcript: string, startTime: number, endTime: number }
  ```
- `session:paused` - Session paused confirmation
- `session:resumed` - Session resumed confirmation
- `session:stopped` - Session stopped confirmation
- `session:error` - Error occurred
- `audio:error` - Audio processing error

## 🚢 Deployment

### Production Checklist

1. **Environment Variables**
   - Set production `DATABASE_URL`
   - Configure production `GEMINI_API_KEY`
   - Set `NEXT_PUBLIC_APP_URL` to your domain
   - Generate secure `BETTER_AUTH_SECRET`

2. **Database**
   ```bash
   npm run db:migrate  # Create migration files
   # Apply migrations in production
   ```

3. **Build**
   ```bash
   npm run build
   npm start
   ```

4. **Process Management**
   - Use PM2 or similar for process management
   - Configure auto-restart on crashes
   - Set up log rotation

5. **HTTPS/SSL**
   - Required for WebSocket connections in production
   - Configure SSL certificates (Let's Encrypt recommended)

6. **Monitoring**
   - Monitor Gemini API rate limits
   - Track WebSocket connection counts
   - Monitor database connection pool usage

### Deployment Platforms

**Vercel** (Recommended for Next.js):
- Automatic deployments from Git
- Built-in SSL
- Note: Requires separate server for Socket.io (consider Railway/Render)

**Railway/Render**:
- Full Node.js support
- Can run Next.js + Socket.io together
- Easy PostgreSQL integration

**Docker**:
```dockerfile
# Example Dockerfile structure
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🐛 Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Verify connection string format
echo $DATABASE_URL

# Test connection
npm run db:studio
```

**WebSocket Connection Failed**
- Check `NEXT_PUBLIC_SOCKET_URL` matches server URL
- Verify CORS settings in `server/index.ts`
- Ensure port 3000 is accessible

**Audio Recording Not Working**
- **Microphone**: Check browser permissions (Settings → Privacy → Microphone)
- **Tab Share**: Ensure browser supports `getDisplayMedia` (Chrome/Edge recommended)
- **No Audio**: Verify audio source is unmuted and active

**Transcription Not Appearing**
- Verify `GEMINI_API_KEY` is set correctly
- Check server logs for API errors
- Ensure audio chunks are being sent (check browser console)

**Session State Issues**
- Clear browser cache and localStorage
- Check database for session status
- Verify WebSocket connection is active

### Debug Mode

Enable verbose logging:
```bash
DEBUG=socket.io:* npm run dev
```

## 📝 Development Scripts

```bash
npm run dev          # Start development server (Next.js + Socket.io)
npm run dev:next     # Start Next.js only
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run db:generate  # Generate Prisma Client
npm run db:push      # Push schema changes (development)
npm run db:migrate   # Create migration (production)
npm run db:studio    # Open Prisma Studio
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) for the amazing framework
- [Socket.io](https://socket.io/) for real-time communication
- [Google Gemini](https://ai.google.dev/) for AI transcription
- [Prisma](https://www.prisma.io/) for database ORM
- [Better Auth](https://www.better-auth.com/) for authentication

## 📧 Support

For questions or issues:
- Open an issue on GitHub
- Check existing documentation
- Review server logs for errors

---

**Built with ❤️ for professionals who need better meeting notes**
