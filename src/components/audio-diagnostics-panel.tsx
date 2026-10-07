import type { AudioDiagnostics } from '@/lib/audio-diagnostics';

export function AudioDiagnosticsPanel({
  result,
  reference,
  referenceSpeed,
}: {
  result: AudioDiagnostics;
  reference?: AudioDiagnostics;
  referenceSpeed?: number;
}) {
  return (
    <section className="shadowing-result" aria-label="Local recording check">
      <strong>Sound activity</strong>
      {result.activity === 'detected' ? (
        <>
          <p className="small">
            Estimated active sound: {result.activeSeconds.toFixed(1)} s in a{' '}
            {result.durationSeconds.toFixed(1)} s recording. Activity starts at{' '}
            {result.activityStart!.toFixed(1)} s and ends at {result.activityEnd!.toFixed(1)} s.
          </p>
          <p className="small">
            {result.pauses.length
              ? `${result.pauses.length} ${result.pauses.length === 1 ? 'pause' : 'pauses'} of at least 0.18 s between active sounds. Listen back to compare your phrasing.`
              : 'No longer pauses detected between active sounds.'}
          </p>
        </>
      ) : (
        <p className="small">
          {result.activity === 'none'
            ? 'No clear activity detected. If you spoke quietly, listen back or move closer to the microphone.'
            : 'The sound level is too steady or unclear to estimate activity and pauses reliably. Listen back to check your recording.'}
        </p>
      )}
      {reference?.activity === 'detected' && result.activity === 'detected' ? (
        <p className="small">
          Local source at {referenceSpeed}×: {reference.activeSeconds.toFixed(1)} s active sound
          with {reference.pauses.length} internal{' '}
          {reference.pauses.length === 1 ? 'pause' : 'pauses'}. These measurements describe this
          excerpt; compare phrasing by listening back.
        </p>
      ) : null}
      {result.clippedFraction >= 0.001 ? (
        <p className="small">
          Some decoded samples are near full scale. If playback sounds distorted, try moving farther
          from the microphone.
        </p>
      ) : result.activity === 'detected' && result.peakDbfs < -30 ? (
        <p className="small">
          The recording level is low. Check your microphone distance before trying again.
        </p>
      ) : null}
      <p className="small muted">
        Measured on this device. Energy-based estimates can include background noise or music; they
        do not measure pronunciation or affect your Shadowing Match score.
      </p>
    </section>
  );
}
