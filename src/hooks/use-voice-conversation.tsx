import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "ENDED" | "ERROR";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Options = {
  /** Called with the final transcript once the patient stops speaking. */
  onTranscript: (text: string) => void;
};

export function useVoiceConversation({ onTranscript }: Options) {
  const [supported, setSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("IDLE");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [autoMode, setAutoMode] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const mutedRef = useRef(false);
  const autoRef = useRef(false);
  const stateRef = useRef<VoiceState>("IDLE");
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  mutedRef.current = muted;
  autoRef.current = autoMode;

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    setSupported(Boolean(getRecognitionCtor()));
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition is not available in this browser. Use the text box instead.");
      setVoiceState("ERROR");
      return;
    }
    if (stateRef.current === "LISTENING") return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    finalRef.current = "";
    setTranscript("");
    setError(null);

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current += result[0].transcript;
        else interim += result[0].transcript;
      }
      setTranscript((finalRef.current + interim).trim());
    };
    recognition.onerror = (event: any) => {
      const code = event?.error;
      if (code === "aborted" || code === "no-speech") {
        return;
      }
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access was blocked. Allow the microphone (or open the app in its own browser tab) — meanwhile you can type below."
          : `Speech recognition error: ${code ?? "unknown"}`,
      );
      setVoiceState("ERROR");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      const text = finalRef.current.trim();
      if (stateRef.current !== "LISTENING") return;
      if (text) {
        setVoiceState("PROCESSING");
        onTranscriptRef.current(text);
      } else {
        setVoiceState("IDLE");
      }
    };

    recognitionRef.current = recognition;
    setVoiceState("LISTENING");
    try {
      recognition.start();
    } catch {
      setError("Could not start the microphone.");
      setVoiceState("ERROR");
    }
  }, [setVoiceState]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const cancelListening = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setVoiceState("IDLE");
    recognition?.abort();
  }, [setVoiceState]);

  const stopSpeaking = useCallback(() => {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    if (stateRef.current === "SPEAKING") setVoiceState("IDLE");
  }, [setVoiceState]);

  /** Speak an AI Doctor reply, then re-open the microphone when in auto mode. */
  const speak = useCallback(
    (text: string) => {
      const finish = () => {
        if (stateRef.current === "ENDED") return;
        setVoiceState("IDLE");
        if (autoRef.current && getRecognitionCtor()) {
          window.setTimeout(() => {
            if (stateRef.current === "IDLE" && autoRef.current) startListening();
          }, 350);
        }
      };

      if (mutedRef.current || !("speechSynthesis" in window) || !text.trim()) {
        finish();
        return;
      }

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.onend = finish;
        utterance.onerror = finish;
        setVoiceState("SPEAKING");
        window.speechSynthesis.speak(utterance);
      } catch {
        finish();
      }
    },
    [setVoiceState, startListening],
  );

  const endSession = useCallback(() => {
    autoRef.current = false;
    setAutoMode(false);
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setVoiceState("ENDED");
  }, [setVoiceState]);

  const reset = useCallback(() => {
    setError(null);
    setTranscript("");
    setVoiceState("IDLE");
  }, [setVoiceState]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    },
    [],
  );

  return {
    supported,
    speechSupported,
    state,
    transcript,
    error,
    muted,
    setMuted,
    autoMode,
    setAutoMode,
    startListening,
    stopListening,
    cancelListening,
    stopSpeaking,
    speak,
    setVoiceState,
    endSession,
    reset,
  };
}
