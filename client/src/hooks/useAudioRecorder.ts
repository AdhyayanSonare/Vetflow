import { useCallback, useEffect, useRef } from "react";
import { VoiceError, describeMicError, pickRecorderMimeType } from "@/lib/voice";

/** Microphone capture with pause/resume. Tracks are always released on stop, cancel and unmount. */
export function useAudioRecorder() {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }
    chunksRef.current = [];
    releaseStream();
  }, [releaseStream]);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new VoiceError("This browser can't record audio. Use a current Chrome, Edge, Firefox or Safari over HTTPS — or upload an audio file instead.", "UNSUPPORTED_BROWSER");
    }
    cancel();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      throw describeMicError(error);
    }
    try {
      const mimeType = pickRecorderMimeType(MediaRecorder);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(1000);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      throw describeMicError(error);
    }
  }, [cancel]);

  const pause = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.pause();
  }, []);

  const resume = useCallback(() => {
    if (recorderRef.current?.state === "paused") recorderRef.current.resume();
  }, []);

  /** Ends recording and resolves with the captured audio. */
  const stop = useCallback((): Promise<Blob> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.reject(new VoiceError("There is no active recording.", "NO_RECORDING"));
    return new Promise<Blob>((resolve, reject) => {
      const finish = () => {
        const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        if (blob.size === 0) reject(new VoiceError("Nothing was recorded. Check your microphone and try again.", "EMPTY_AUDIO"));
        else resolve(blob);
      };
      recorder.onstop = finish;
      recorder.onerror = () => {
        recorderRef.current = null;
        chunksRef.current = [];
        releaseStream();
        reject(new VoiceError("The recording failed. Please try again.", "RECORDER_ERROR"));
      };
      if (recorder.state === "inactive") finish();
      else recorder.stop();
    });
  }, [releaseStream]);

  return { start, pause, resume, stop, cancel };
}
