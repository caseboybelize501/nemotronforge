import { useState, useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { locateModel, modelGenerate, ensureLlamaServerRunning } from '../lib/api';
import type { ModelLocation } from '../types';

// Hardcoded model - llama.cpp format
const HARD_CODED_MODEL = 'qwen3-coder-30b.gguf';
const MODEL_PATH = 'D:\\Users\\CASE\\models\\qwen3-coder-30b.gguf';

export function useModel() {
  const [location, setLocation] = useState<ModelLocation | null>(null);
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [tokensPerSec, setTokensPerSec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [serverStarting, setServerStarting] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [serverStatus, setServerStatus] = useState<string>('Initializing...');

  const accumulatorRef = useRef<string>('');
  const startTimeRef = useRef<number>(0);
  const tokenCountRef = useRef<number>(0);
  const doneResolverRef = useRef<((value: string) => void) | null>(null);

  const unlistenTokenRef = useRef<(() => void) | null>(null);
  const unlistenDoneRef = useRef<(() => void) | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const loc = await locateModel();
      setLocation(loc);
      return loc;
    } catch (e) {
      console.error('Model scan failed:', e);
      return null;
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  // Auto-start llama.cpp server on mount
  useEffect(() => {
    const startServer = async () => {
      setServerStarting(true);
      setServerStatus('Starting llama.cpp server...');

      try {
        const result = await ensureLlamaServerRunning();
        setServerStatus(result);
        setServerReady(true);
      } catch (e: any) {
        setServerStatus(`Server start failed: ${e.message}`);
        setServerReady(false);
      } finally {
        setServerStarting(false);
      }
    };

    startServer();
  }, []);

  // Cleanup helper
  const cleanup = useCallback(() => {
    unlistenTokenRef.current?.();
    unlistenDoneRef.current?.();
    unlistenTokenRef.current = null;
    unlistenDoneRef.current = null;
  }, []);

  const generate = useCallback(async (
    prompt: string,
    system?: string,
    onToken?: (token: string) => void,
    projectPath?: string | null,
  ): Promise<string> => {

    const modelLocation = location || {
      found: true, method: 'llama.cpp', path: null, model: HARD_CODED_MODEL,
    };

    accumulatorRef.current = '';
    tokenCountRef.current = 0;
    startTimeRef.current = Date.now();
    setStreamedText('');
    setCharCount(0);
    setTokenCount(0);
    setTokensPerSec(0);
    setGenerating(true);

    cleanup();

    // Register 'model-done' listener FIRST
    const donePromise = new Promise<string>((resolve) => {
      doneResolverRef.current = resolve;

      listen<string>('model-done', (event) => {
        const finalText = (
          event.payload &&
          event.payload !== 'None' &&
          event.payload !== 'null' &&
          event.payload.length > 0
        )
          ? event.payload
          : accumulatorRef.current;

        setStreamedText(finalText);
        setCharCount(finalText.length);
        resolve(finalText);
      }).then((fn) => { unlistenDoneRef.current = fn; });
    });

    // Register token listener
    listen<string>('model-token', (event) => {
      const chunk = event.payload;

      if (!chunk || chunk === 'None' || chunk === 'null') return;

      accumulatorRef.current += chunk;
      setStreamedText(accumulatorRef.current);
      setCharCount(accumulatorRef.current.length);

      tokenCountRef.current += 1;
      setTokenCount(tokenCountRef.current);

      const elapsedMs = Date.now() - startTimeRef.current;
      const elapsedSec = elapsedMs / 1000;
      setElapsedSec(Math.round(elapsedSec));

      if (elapsedSec > 0) {
        setTokensPerSec(Math.round(tokenCountRef.current / elapsedSec));
      }

      onToken?.(chunk);
    }).then((fn) => { unlistenTokenRef.current = fn; });

    try {
      modelGenerate(modelLocation, prompt, system, projectPath).catch((err: any) => {
        console.error('[useModel] modelGenerate error:', err);
        doneResolverRef.current?.(accumulatorRef.current);
      });

      const result = await donePromise;
      return result;

    } finally {
      await new Promise((r) => setTimeout(r, 150));
      cleanup();
      setGenerating(false);
    }
  }, [cleanup, location]);

  return {
    location,
    scanning,
    generating,
    streamedText,
    charCount,
    tokenCount,
    tokensPerSec,
    elapsedSec,
    scan,
    generate,
    serverStarting,
    serverReady,
    serverStatus,
  };
}
