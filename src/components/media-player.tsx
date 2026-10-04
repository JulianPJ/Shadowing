'use client';
import { forwardRef } from 'react';
import type { Lesson } from '@/lib/types';
import { lessonMedia } from '@/lib/media';
import { YouTubeMedia } from './media-youtube';
import { VimeoMedia } from './media-vimeo';
import { HtmlMedia } from './media-html';

export interface MediaHandle {
  play(): Promise<void>; pause(): void; seek(time: number): void;
  time(): number; setSpeed(speed: number): void; isPlaying(): boolean;
}
export type MediaPlayerProps = { lesson: Lesson; speed: number; initialTime: number; onReady: () => void; onPlaying: (playing: boolean) => void; onEnded: () => void; onError: (message: string) => void };
export const MediaPlayer = forwardRef<MediaHandle, MediaPlayerProps>(function MediaPlayer(props, ref) {
  const source = lessonMedia(props.lesson);
  if (source.type === 'youtube') return <YouTubeMedia ref={ref} {...props} />;
  if (source.type === 'vimeo') return <VimeoMedia ref={ref} {...props} />;
  return <HtmlMedia key={props.lesson.mediaUrl || (source.type === 'direct' ? source.canonicalUrl : props.lesson.id)} ref={ref} {...props} />;
});
