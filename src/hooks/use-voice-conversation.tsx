import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "ENDED" | "ERROR";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
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

/** How long the patient may pause mid-sentence before the turn is submitted. */
const SILENCE_AFTER_SPEECH_MS = 2500;
/** How long we keep the mic open when nothing has been said yet. */
const SILENCE_BEFORE_SPEECH_MS = 10000;


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

  const silenceTimerRef = useRef<number | null>(null);
  const submittedRef = useRef(false);
  const manualStopRef = useRef(false);
  const restartAttemptsRef = useRef(0);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  /** Submit the collected speech exactly once per listening turn. */
  const submitTurn = useCallback(() => {
    if (submittedRef.current) return;
    const text = (finalRef.current || "").trim();
    if (!text) return;
    submittedRef.current = true;
    clearSilenceTimer();
    manualStopRef.current = true;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.stop();
    } catch {
      /* noop */
    }
    setVoiceState("PROCESSING");
    onTranscriptRef.current(text);
  }, [clearSilenceTimer, setVoiceState]);

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
    // Continuous keeps the mic open through natural pauses; we decide when the
    // patient has finished with our own silence timer instead of letting the
    // browser cut the turn off after the first short gap.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    finalRef.current = "";
    submittedRef.current = false;
    manualStopRef.current = false;
    restartAttemptsRef.current = 0;
    setTranscript("");
    setError(null);

    const armSilenceTimer = () => {
      clearSilenceTimer();
      const delay = finalRef.current.trim() ? SILENCE_AFTER_SPEECH_MS : SILENCE_BEFORE_SPEECH_MS;
      silenceTimerRef.current = window.setTimeout(() => {
        if (stateRef.current !== "LISTENING") return;
        if (finalRef.current.trim()) submitTurn();
        else {
          manualStopRef.current = true;
          const active = recognitionRef.current;
          recognitionRef.current = null;
          try {
            active?.stop();
          } catch {
            /* noop */
          }
          setVoiceState("IDLE");
        }
      }, delay);
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      setTranscript((finalRef.current + interim).replace(/\s+/g, " ").trim());
      armSilenceTimer();
    };
    recognition.onerror = (event: any) => {
      const code = event?.error;
      // These are normal during pauses or flaky network — onend restarts the mic.
      if (code === "aborted" || code === "no-speech" || code === "network") return;
      clearSilenceTimer();
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access was blocked. Allow the microphone (or open the app in its own browser tab) — meanwhile you can type below."
          : `Speech recognition error: ${code ?? "unknown"}`,
      );
      setVoiceState("ERROR");
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (stateRef.current !== "LISTENING") return;
      if (manualStopRef.current) {
        if (finalRef.current.trim()) submitTurn();
        else setVoiceState("IDLE");
        return;
      }
      // The engine ended the session on its own (short pause or transient
      // network hiccup). Keep the turn alive by restarting the recognizer.
      if (restartAttemptsRef.current < 12) {
        restartAttemptsRef.current += 1;
        try {
          recognition.start();
          recognitionRef.current = recognition;
          armSilenceTimer();
          return;
        } catch {
          /* fall through */
        }
      }
      if (finalRef.current.trim()) submitTurn();
      else setVoiceState("IDLE");
    };

    recognitionRef.current = recognition;
    setVoiceState("LISTENING");
    try {
      recognition.start();
      armSilenceTimer();
    } catch {
      setError("Could not start the microphone.");
      setVoiceState("ERROR");
    }
  }, [clearSilenceTimer, setVoiceState, submitTurn]);


  /** Manual "I'm done talking" — send whatever has been captured. */
  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    if (finalRef.current.trim()) {
      submitTurn();
      return;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
  }, [clearSilenceTimer, submitTurn]);

  const cancelListening = useCallback(() => {
    manualStopRef.current = true;
    submittedRef.current = true;
    clearSilenceTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setVoiceState("IDLE");
    recognition?.abort();
  }, [clearSilenceTimer, setVoiceState]);


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
    manualStopRef.current = true;
    submittedRef.current = true;
    clearSilenceTimer();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setVoiceState("ENDED");
  }, [clearSilenceTimer, setVoiceState]);

  const reset = useCallback(() => {
    setError(null);
    setTranscript("");
    setVoiceState("IDLE");
  }, [setVoiceState]);

  useEffect(
    () => () => {
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
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
