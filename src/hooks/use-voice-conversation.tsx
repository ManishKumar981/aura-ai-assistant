import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type VoiceState = "IDLE" | "LISTENING" | "RECORDING" | "TRANSCRIBING" | "PROCESSING" | "SPEAKING" | "ENDED" | "ERROR";

export const VOICE_CAPTURE_CONFIG = {
  startupGraceMs: 500,
  silenceAfterSpeechMs: 1800,
  silenceBeforeSpeechMs: 10000,
  speechThreshold: 0.012,
  prerollMs: 800,
} as const;


type Options = { onTranscript: (text: string) => void };

function audioContextConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function canRecordAudio() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(audioContextConstructor());
}

/** Browser-native Web Speech API — free, no server STT provider / AI credits involved. */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function speechRecognitionConstructor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

function canUseBrowserStt() {
  return Boolean(speechRecognitionConstructor());
}

/**
 * Recognition accuracy drops sharply when the locale does not match the speaker
 * (e.g. an Indian-English speaker recognised as en-US). Prefer the browser locale,
 * fall back to en-US, and allow an explicit override via localStorage.
 */
export function speechLanguage(): string {
  if (typeof window === "undefined") return "en-US";
  try {
    const override = window.localStorage.getItem("aura.voice.lang");
    if (override) return override;
  } catch { /* storage blocked */ }
  const locale = navigator.language || "en-US";
  return /^[a-z]{2}-[A-Z]{2}$/.test(locale) ? locale : "en-US";
}



function encodeWav(chunks: Float32Array[], inputRate: number): Blob {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const outputRate = 16000;
  const ratio = inputRate / outputRate;
  const output = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + output.byteLength);
  const view = new DataView(buffer);
  const write = (at: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + output.byteLength, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true); view.setUint32(28, outputRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, output.byteLength, true); new Int16Array(buffer, 44).set(output);
  return new Blob([buffer], { type: "audio/wav" });
}

export function useVoiceConversation({ onTranscript }: Options) {
  const [supported, setSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [state, setState] = useState<VoiceState>("IDLE");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const stateRef = useRef<VoiceState>("IDLE");
  const mutedRef = useRef(false);
  const autoRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48000);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const lastSpeechAtRef = useRef(0);
  const speechDetectedRef = useRef(false);
  const generationRef = useRef(0);
  const ringRef = useRef<Float32Array[]>([]);
  const activeRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTextRef = useRef("");
  const submittedRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const networkErrorCountRef = useRef(0);
  // Kept separate from timerRef (a setInterval id) so clearing one never leaks the other.
  const retryTimerRef = useRef<number | null>(null);
  const restartCountRef = useRef(0);

  const [sttMode, setSttMode] = useState<"browser" | "provider" | "none">("none");
  onTranscriptRef.current = onTranscript; mutedRef.current = muted; autoRef.current = autoMode;

  const setVoiceState = useCallback((next: VoiceState) => { stateRef.current = next; setState(next); }, []);
  useEffect(() => {
    const browser = canUseBrowserStt();
    setSttMode(browser ? "browser" : canRecordAudio() ? "provider" : "none");
    setSupported(browser || canRecordAudio());
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);


  const releaseCapture = useCallback(async () => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); window.clearTimeout(timerRef.current as unknown as number); }
    timerRef.current = null; activeRef.current = false; ringRef.current = [];
    processorRef.current?.disconnect(); sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    processorRef.current = null; sourceRef.current = null; streamRef.current = null;
    const context = contextRef.current; contextRef.current = null;
    if (context && context.state !== "closed") await context.close().catch(() => undefined);
  }, []);

  // Keeps the microphone graph warm between turns and continuously buffers a short
  // pre-roll window so the first words are never clipped when a turn starts.
  const ensureCapture = useCallback(async () => {
    const live = streamRef.current?.getAudioTracks().some((track) => track.readyState === "live");
    if (live && contextRef.current && contextRef.current.state !== "closed") {
      await contextRef.current.resume().catch(() => undefined);
      return;
    }
    await releaseCapture();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const Ctor = audioContextConstructor(); if (!Ctor) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Audio recording is unavailable."); }
    const context = new Ctor(); await context.resume();
    const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(2048, 1, 1);
    streamRef.current = stream; contextRef.current = context; sourceRef.current = source; processorRef.current = processor;
    sampleRateRef.current = context.sampleRate; ringRef.current = [];
    processor.onaudioprocess = (event) => {
      const samples = new Float32Array(event.inputBuffer.getChannelData(0));
      if (activeRef.current) {
        pcmRef.current.push(samples);
        let energy = 0; for (let i = 0; i < samples.length; i += 1) energy += (samples[i] ?? 0) ** 2;
        if (Math.sqrt(energy / Math.max(1, samples.length)) >= VOICE_CAPTURE_CONFIG.speechThreshold) {
          speechDetectedRef.current = true; lastSpeechAtRef.current = performance.now();
          if (stateRef.current === "LISTENING") setVoiceState("RECORDING");
        }
        return;
      }
      // Never buffer while the AI Doctor is speaking, so its voice is not recorded.
      if (stateRef.current === "SPEAKING" || stateRef.current === "ENDED") { ringRef.current = []; return; }
      ringRef.current.push(samples);
      const maxSamples = Math.round((sampleRateRef.current * VOICE_CAPTURE_CONFIG.prerollMs) / 1000);
      let total = ringRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
      while (ringRef.current.length > 1 && total - (ringRef.current[0]?.length ?? 0) >= maxSamples) {
        total -= ringRef.current.shift()?.length ?? 0;
      }
    };
    source.connect(processor); processor.connect(context.destination);
  }, [releaseCapture, setVoiceState]);


  const transcribe = useCallback(async (chunks: Float32Array[], sampleRate: number) => {
    const wav = encodeWav(chunks, sampleRate);
    if (wav.size < 2048) throw new Error("That recording was empty — please try again.");
    setVoiceState("TRANSCRIBING"); setTranscript("");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const body = new FormData(); body.append("audio", wav, "recording.wav");
    const response = await fetch("/api/voice-transcription", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
    if (!response.ok) throw new Error((await response.text().catch(() => "")) || "Could not transcribe the recording.");
    if (!response.body) throw new Error("The transcription service returned no result.");
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let pending = ""; let fullText = ""; let doneText = "";
    while (true) {
      const result = await reader.read(); pending += decoder.decode(result.value, { stream: !result.done });
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
          if (event.type === "transcript.text.delta" && event.delta) { fullText += event.delta; setTranscript(fullText.trimStart()); }
          if (event.type === "transcript.text.done" && event.text) doneText = event.text;
        } catch { /* SSE keep-alive */ }
      }
      if (result.done) break;
    }
    const text = (doneText || fullText).trim();
    if (!text) throw new Error("No speech was recognized. Please try again.");
    setTranscript(text); setVoiceState("PROCESSING"); onTranscriptRef.current(text);
  }, [setVoiceState]);

  const endTurn = useCallback(() => {
    activeRef.current = false; ringRef.current = [];
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const finishCapture = useCallback(async () => {
    if (stateRef.current !== "LISTENING" && stateRef.current !== "RECORDING") return;
    generationRef.current += 1;
    const chunks = pcmRef.current; const sampleRate = sampleRateRef.current; const hasSpeech = speechDetectedRef.current;
    pcmRef.current = []; endTurn();
    if (!hasSpeech) { setVoiceState("IDLE"); return; }
    try { await transcribe(chunks, sampleRate); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not transcribe the recording."); setVoiceState("ERROR"); }
  }, [endTurn, setVoiceState, transcribe]);

  // ---- Browser-native SpeechRecognition path (preferred when available) ----
  const clearVoiceTimers = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (retryTimerRef.current !== null) { window.clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
  }, []);

  const stopRecognition = useCallback((abort: boolean) => {
    const recognition = recognitionRef.current;
    clearVoiceTimers();
    if (!recognition) return;
    if (abort) { recognitionRef.current = null; recognition.onresult = null; recognition.onerror = null; recognition.onend = null; try { recognition.abort(); } catch { /* already stopped */ } }
    else { try { recognition.stop(); } catch { /* already stopped */ } }
  }, [clearVoiceTimers]);

  const finalizeRecognitionTurn = useCallback(() => {
    clearVoiceTimers();
    recognitionRef.current = null;
    if (submittedRef.current) return; // guards against duplicate patient messages
    submittedRef.current = true;
    const text = finalTextRef.current.trim();
    if (!text) { if (stateRef.current === "LISTENING" || stateRef.current === "RECORDING") setVoiceState("IDLE"); return; }
    setTranscript(text); setVoiceState("PROCESSING"); onTranscriptRef.current(text);
  }, [clearVoiceTimers, setVoiceState]);

  const startBrowserListening = useCallback(() => {
    const Ctor = speechRecognitionConstructor();
    if (!Ctor) return false;
    const generation = generationRef.current + 1; generationRef.current = generation;
    clearVoiceTimers();
    const recognition = new Ctor();
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = speechLanguage(); recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    finalTextRef.current = ""; submittedRef.current = false; speechDetectedRef.current = false;
    networkErrorCountRef.current = 0; restartCountRef.current = 0; intentionalStopRef.current = false;
    startedAtRef.current = performance.now(); lastSpeechAtRef.current = startedAtRef.current;
    setVoiceState("LISTENING"); setTranscript(""); setError(null); window.speechSynthesis?.cancel();

    recognition.onresult = (event) => {
      if (generationRef.current !== generation) return;
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]; if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) finalChunk += `${finalChunk ? " " : ""}${text}`.trim();
        else interim += text;
      }
      if (finalChunk) finalTextRef.current = `${finalTextRef.current} ${finalChunk}`.trim();
      const combined = `${finalTextRef.current} ${interim}`.trim();
      if (finalChunk || interim.trim()) { speechDetectedRef.current = true; lastSpeechAtRef.current = performance.now(); }
      if (stateRef.current === "LISTENING" && speechDetectedRef.current) setVoiceState("RECORDING");
      setTranscript(combined);
    };
    recognition.onerror = (event) => {
      if (generationRef.current !== generation) return;
      const code = event.error ?? "";
      if (code === "no-speech" || code === "aborted") return; // onend handles the turn

      // Network errors are transient in Chrome: retry with bounded backoff.
      if (code === "network") {
        networkErrorCountRef.current += 1;
        if (networkErrorCountRef.current <= 3) {
          const backoffMs = Math.min(400 * 2 ** (networkErrorCountRef.current - 1), 3000);
          const carried = finalTextRef.current;
          stopRecognition(true);
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (generationRef.current !== generation) return;
            if (startBrowserListening()) { finalTextRef.current = carried; return; }
            submittedRef.current = true;
            setError("Speech recognition is unavailable right now. Please type your message instead.");
            setVoiceState("ERROR");
          }, backoffMs);
          return;
        }
        submittedRef.current = true;
        stopRecognition(true);
        setError("Speech recognition lost its network connection. Please try again or use text.");
        setVoiceState("ERROR");
        return;
      }

      submittedRef.current = true;
      stopRecognition(true);
      setError(code === "not-allowed" || code === "service-not-allowed"
        ? "Microphone access was blocked. Allow the microphone (or open the app in its own browser tab) — meanwhile you can type below."
        : "Speech recognition failed. Please try again or type your message.");
      setVoiceState("ERROR");
    };
    recognition.onend = () => {
      if (generationRef.current !== generation) return;
      if (submittedRef.current) return;

      // Intentional stop (silence timer or manual stop) -> submit the turn.
      if (intentionalStopRef.current) { intentionalStopRef.current = false; finalizeRecognitionTurn(); return; }

      // Chrome ends the session on its own after a short pause. Restart so natural
      // pauses mid-sentence do not cut the patient off, but cap the restarts.
      restartCountRef.current += 1;
      if (restartCountRef.current > 8) { finalizeRecognitionTurn(); return; }
      try {
        recognition.start();
        // Restarting resets the engine's silence tracking; keep our own timer honest.
        lastSpeechAtRef.current = performance.now();
      } catch {
        finalizeRecognitionTurn();
      }
    };

    try { recognition.start(); } catch { recognitionRef.current = null; return false; }

    timerRef.current = window.setInterval(() => {
      const now = performance.now(); const elapsed = now - startedAtRef.current;
      if (!speechDetectedRef.current) { if (elapsed >= VOICE_CAPTURE_CONFIG.silenceBeforeSpeechMs) { intentionalStopRef.current = true; stopRecognition(false); } return; }
      if (elapsed >= VOICE_CAPTURE_CONFIG.startupGraceMs && now - lastSpeechAtRef.current >= VOICE_CAPTURE_CONFIG.silenceAfterSpeechMs) { intentionalStopRef.current = true; stopRecognition(false); }
    }, 100);
    return true;
  }, [clearVoiceTimers, finalizeRecognitionTurn, setVoiceState, stopRecognition]);


  const startListening = useCallback(async () => {
    if (stateRef.current === "LISTENING" || stateRef.current === "RECORDING") return;
    // Preferred path: browser-native SpeechRecognition (no server STT provider, no AI credits).
    if (canUseBrowserStt() && startBrowserListening()) return;
    if (!canRecordAudio()) { setError("Microphone recording is not available in this browser. Use the text box instead."); setVoiceState("ERROR"); return; }
    const generation = generationRef.current + 1; generationRef.current = generation;
    setVoiceState("LISTENING"); setTranscript(""); setError(null); window.speechSynthesis?.cancel();

    try {
      await ensureCapture();
      if (generationRef.current !== generation) return;
      // Seed the turn with the buffered pre-roll audio so the first words are kept.
      pcmRef.current = ringRef.current.slice(); ringRef.current = [];
      speechDetectedRef.current = false;
      startedAtRef.current = performance.now(); lastSpeechAtRef.current = startedAtRef.current;
      activeRef.current = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        const now = performance.now(); const elapsed = now - startedAtRef.current;
        if (!speechDetectedRef.current && elapsed >= VOICE_CAPTURE_CONFIG.silenceBeforeSpeechMs) void finishCapture();
        else if (speechDetectedRef.current && elapsed >= VOICE_CAPTURE_CONFIG.startupGraceMs && now - lastSpeechAtRef.current >= VOICE_CAPTURE_CONFIG.silenceAfterSpeechMs) void finishCapture();
      }, 100);
    } catch (cause) {
      generationRef.current += 1; await releaseCapture();
      setError(cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError")
        ? "Microphone access was blocked. Allow the microphone (or open the app in its own browser tab) — meanwhile you can type below."
        : cause instanceof Error ? cause.message : "Could not start the microphone.");
      setVoiceState("ERROR");
    }
  }, [ensureCapture, finishCapture, releaseCapture, setVoiceState]);


  const stopListening = useCallback(() => {
    if (recognitionRef.current) { if (timerRef.current !== null) window.clearTimeout(timerRef.current as unknown as number); intentionalStopRef.current = true; stopRecognition(false); return; }
    void finishCapture();
  }, [finishCapture, stopRecognition]);
  const cancelListening = useCallback(() => {
    generationRef.current += 1; submittedRef.current = true; finalTextRef.current = "";
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    intentionalStopRef.current = true;
    stopRecognition(true);
    pcmRef.current = []; speechDetectedRef.current = false; endTurn(); setVoiceState("IDLE");
  }, [endTurn, setVoiceState, stopRecognition]);
  const stopSpeaking = useCallback(() => { window.speechSynthesis?.cancel(); if (stateRef.current === "SPEAKING") setVoiceState("IDLE"); }, [setVoiceState]);
  const speak = useCallback((text: string) => {
    const finish = () => { if (stateRef.current === "ENDED") return; setVoiceState("IDLE"); if (autoRef.current && (canUseBrowserStt() || canRecordAudio())) window.setTimeout(() => { if (stateRef.current === "IDLE" && autoRef.current) void startListening(); }, 350); };
    if (mutedRef.current || !("speechSynthesis" in window) || !text.trim()) { finish(); return; }
    try { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US"; utterance.rate = 1; utterance.pitch = 1; utterance.onend = finish; utterance.onerror = finish; setVoiceState("SPEAKING"); window.speechSynthesis.speak(utterance); } catch { finish(); }
  }, [setVoiceState, startListening]);
  const endSession = useCallback(() => { autoRef.current = false; setAutoMode(false); generationRef.current += 1; submittedRef.current = true; intentionalStopRef.current = true; stopRecognition(true); pcmRef.current = []; void releaseCapture(); window.speechSynthesis?.cancel(); setVoiceState("ENDED"); }, [releaseCapture, setVoiceState, stopRecognition]);
  const reset = useCallback(() => { setError(null); setTranscript(""); setVoiceState("IDLE"); }, [setVoiceState]);

  // Warm the microphone ahead of the first turn when permission was already granted,
  // so the pre-roll buffer is filled before the patient starts speaking.
  // Only needed for the server STT provider path; browser SpeechRecognition manages its own capture.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (canUseBrowserStt() || !canRecordAudio()) return;
      const granted = await navigator.permissions?.query({ name: "microphone" as PermissionName }).then((s) => s.state === "granted").catch(() => false);
      if (!granted || cancelled || stateRef.current !== "IDLE" || streamRef.current) return;
      await ensureCapture().catch(() => undefined);
    })();
    return () => { cancelled = true; };
  }, [ensureCapture]);




  useEffect(() => () => { generationRef.current += 1; if (timerRef.current !== null) window.clearInterval(timerRef.current); const recognition = recognitionRef.current; recognitionRef.current = null; if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; try { recognition.abort(); } catch { /* already stopped */ } } processorRef.current?.disconnect(); sourceRef.current?.disconnect(); streamRef.current?.getTracks().forEach((track) => track.stop()); void contextRef.current?.close(); window.speechSynthesis?.cancel(); }, []);

  return { supported, speechSupported, sttMode, state, transcript, error, muted, setMuted, autoMode, setAutoMode, startListening, stopListening, cancelListening, stopSpeaking, speak, setVoiceState, endSession, reset };

}
