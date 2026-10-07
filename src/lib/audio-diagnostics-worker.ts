import { analyzeAudioDiagnostics } from './audio-diagnostics';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => void;
  postMessage: (value: unknown) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ result: analyzeAudioDiagnostics(data.channels, data.sampleRate) });
  } catch {
    scope.postMessage({ error: true });
  }
};
