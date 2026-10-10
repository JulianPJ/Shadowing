'use client';
import Link from 'next/link';
import { Bookmark, BookmarkCheck, ArrowUpRight, Captions, Heart, EyeOff } from 'lucide-react';
import { BANDS, TOPICS, type Card } from '@/lib/discover/types';
import { timestamp } from '@/lib/youtube';
import { recordDiscoveryEvents } from '@/lib/discover/client';
export function VideoCard({
  video,
  saved,
  onSave,
  onFeedback,
  onOpen,
}: {
  video: Card;
  saved: boolean;
  onSave: () => void;
  onFeedback: (action: 'not_interested' | 'more_like_this') => void;
  onOpen: () => void;
}) {
  const label = video.band ? BANDS.find((b) => b[0] === video.band)![1] : 'Level not yet estimated';
  return (
    <article className="discover-card">
      <Link
        className="discover-card-link"
        href={`/prepare?video=${encodeURIComponent(video.canonicalUrl)}`}
        onClick={() => {
          onOpen();
          void recordDiscoveryEvents([{ videoId: video.videoId, action: 'open' }]);
        }}
        aria-label={`Start shadowing: ${video.title}`}
      >
        <div className="discover-thumbnail">
          {video.thumbnailUrl /* YouTube metadata URLs are allowlisted at ingestion; no proxy/rehosting. */ ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={video.thumbnailUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              width="480"
              height="270"
            />
          ) : (
            <span className="discover-image-fallback" aria-hidden="true">
              響<span>Japanese, in your own time.</span>
            </span>
          )}
          <span className="discover-duration">{timestamp(video.durationSeconds)}</span>
          <span className="discover-play">
            Start shadowing <ArrowUpRight size={16} />
          </span>
        </div>
        <div className="discover-card-copy">
          <h3>{video.title}</h3>
          <p className="discover-channel">{video.channelTitle}</p>
          <div className="discover-tags">
            <span
              className={video.band ? 'discover-band' : 'discover-band unknown'}
              title={
                video.band
                  ? 'Approximate content difficulty from a validated full Japanese transcript.'
                  : 'Hibiki estimates a level after analysing the full Japanese transcript.'
              }
            >
              {video.band ? '≈ ' : ''}
              {label}
            </span>
            {video.topics[0] ? <span>{TOPICS[video.topics[0]]}</span> : null}
            {video.audience ? (
              <span>{video.audience === 'learner' ? 'For learners' : 'Native content'}</span>
            ) : null}
          </div>
          <p className="discover-reason">{video.reason}</p>
          <p className="discover-captions">
            <Captions size={14} />
            {video.prepared
              ? 'Japanese captions ready in Hibiki'
              : video.preparationStatus === 'needs-captions'
                ? 'Your own Japanese captions are needed'
                : video.captionFlag
                  ? 'YouTube reports captions · language unchecked'
                  : 'Captions checked when you start'}
          </p>
        </div>
      </Link>
      <div className="discover-card-actions">
        <button
          className="text-button"
          aria-pressed={saved}
          aria-label={`${saved ? 'Remove' : 'Save'} ${video.title} ${saved ? 'from' : 'to'} Watch Later`}
          onClick={onSave}
        >
          {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}{' '}
          {saved ? 'Saved' : 'Save for later'}
        </button>
        <details className="discover-feedback">
          <summary aria-label={`Options for ${video.title}`}>•••</summary>
          <div>
            <button onClick={() => onFeedback('more_like_this')}>
              <Heart size={15} /> More like this
            </button>
            <button onClick={() => onFeedback('not_interested')}>
              <EyeOff size={15} /> Not interested
            </button>
            <p>Why this video? {video.reason}. Content levels are estimates.</p>
            <a href={video.canonicalUrl} target="_blank" rel="noreferrer">
              View on YouTube ↗
            </a>
          </div>
        </details>
      </div>
    </article>
  );
}
