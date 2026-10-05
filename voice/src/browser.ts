export type VoiceState =
  "IDLE" | "LISTENING" | "PROCESSING" | "THINKING" | "SPEAKING" | "ERROR";
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export class BrowserVoice {
  private recognition?: Recognition;
  constructor(
    private readonly state: (state: VoiceState, detail?: string) => void,
  ) {}
  get available() {
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }
  async listen(language: string, onText: (text: string) => void) {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = undefined;
      return;
    }
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone is unavailable; use HTTPS or type a message.",
        );
      const w = window as unknown as {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      };
      const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      if (!Constructor)
        throw new Error(
          "Browser speech recognition is unavailable. Type a message; local STT is not connected.",
        );
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      const recognition = new Constructor();
      this.recognition = recognition;
      recognition.lang = language;
      recognition.continuous = false;
      recognition.interimResults = false;
      let submitted = false;
      let failed = false;
      recognition.onresult = (event) => {
        submitted = true;
        this.state("PROCESSING");
        onText(event.results[0][0].transcript);
      };
      recognition.onerror = (event) => {
        failed = true;
        this.state(
          "ERROR",
          event.error === "not-allowed"
            ? "Microphone permission denied. Enable access or type a message."
            : `Speech recognition failed: ${event.error}`,
        );
      };
      recognition.onend = () => {
        this.recognition = undefined;
        if (!submitted && !failed) this.state("IDLE");
      };
      window.speechSynthesis?.cancel();
      recognition.start();
      this.state("LISTENING");
    } catch (error) {
      this.recognition = undefined;
      this.state(
        "ERROR",
        error instanceof Error ? error.message : "Microphone permission denied",
      );
    }
  }
  speak(text: string, language: string) {
    if (!window.speechSynthesis) {
      this.state("IDLE", "Browser TTS is unavailable");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
    utterance.lang = language;
    utterance.onstart = () => this.state("SPEAKING");
    utterance.onend = () => this.state("IDLE");
    utterance.onerror = () => this.state("ERROR", "Speech output failed");
    window.speechSynthesis.speak(utterance);
  }
  stop() {
    this.recognition?.stop();
    this.recognition = undefined;
    window.speechSynthesis?.cancel();
    this.state("IDLE");
  }
}
