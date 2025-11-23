import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Zap, Shield, Clock, Users, ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Mic className="h-4 w-4" />
            <span>AI-Powered Transcription</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
            Turn Your Meetings Into
            <br />
            <span className="text-primary">Searchable Transcripts</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            ScribeAI captures and transcribes audio from your microphone or meeting tabs in real-time.
            Never miss important details from your meetings again.
          </p>
          <div className="flex gap-4 justify-center pt-4">
            <Button size="lg" asChild>
              <Link href="/sign-up">
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Why Choose ScribeAI?</h2>
          <p className="text-muted-foreground text-lg">
            Everything you need for professional meeting transcription
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <Zap className="h-10 w-10 text-primary mb-4" />
              <CardTitle>Real-Time Transcription</CardTitle>
              <CardDescription>
                Get live transcriptions as you speak. Powered by Google Gemini AI for accurate,
                multi-speaker diarization.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Clock className="h-10 w-10 text-primary mb-4" />
              <CardTitle>Long Sessions Supported</CardTitle>
              <CardDescription>
                Handle sessions up to 1+ hours with chunked streaming. No memory overload, seamless
                performance.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <Shield className="h-10 w-10 text-primary mb-4" />
              <CardTitle>Secure & Private</CardTitle>
              <CardDescription>
                Your data is encrypted and stored securely. Full control over your transcripts and
                summaries.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-6 py-20 bg-muted/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg">
              Three simple steps to transform your meetings
            </p>
          </div>
          <div className="space-y-8">
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                1
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Start Recording</h3>
                <p className="text-muted-foreground">
                  Choose between microphone input or capture audio from shared meeting tabs (Google
                  Meet, Zoom, etc.).
                </p>
              </div>
            </div>
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                2
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Live Transcription</h3>
                <p className="text-muted-foreground">
                  Watch your meeting get transcribed in real-time. Pause, resume, or stop recording
                  anytime.
                </p>
              </div>
            </div>
            <div className="flex gap-6 items-start">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                3
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">Get AI Summary</h3>
                <p className="text-muted-foreground">
                  When you stop, get an instant AI-generated summary with key points, action items,
                  and decisions. Export or download anytime.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6 py-20">
        <Card className="max-w-3xl mx-auto text-center">
          <CardHeader>
            <CardTitle className="text-3xl mb-4">Ready to Get Started?</CardTitle>
            <CardDescription className="text-lg">
              Join thousands of professionals who trust ScribeAI for their meeting transcription
              needs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" asChild>
              <Link href="/sign-up">
                Create Free Account
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

