'use client';
import Link from 'next/link';
import { AudioLines, ArrowUpRight, X, Headphones, Mic, Repeat2, Keyboard } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function Header({ onHelp, player = false }: { onHelp: () => void; player?: boolean }) {
  return <header className={`site-header ${player ? 'practice-header' : ''}`}><div className="header-inner">
    <Link className="brand" href="/" aria-label="Hibiki home"><span className="brand-mark"><AudioLines size={22} strokeWidth={1.6} /></span><span>hibiki<span className="brand-japanese" lang="ja">響</span></span></Link>
    <nav aria-label="Main navigation"><Link className="nav-link" href="/progress">Progress</Link><button className="nav-link" onClick={onHelp}>{player ? <><Keyboard size={16} /> Shortcuts</> : 'How it works'}</button><Link className="nav-demo" href={player ? '/' : '/practice/demo'}>{player ? 'New practice' : 'Try a practice'}<ArrowUpRight size={15} /></Link></nav>
  </div></header>;
}
export function Footer() { return <footer className="site-footer"><span>Made for a little progress, every day.</span><span lang="ja">聞く。まねる。身につく。</span></footer>; }
export function HelpDialog({ open, onClose, player = false }: { open: boolean; onClose: () => void; player?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  return <dialog ref={ref} className="help-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="help-title">
    <button className="icon-button dialog-close" aria-label="Close help" onClick={onClose}><X size={20} /></button>
    <span className="eyebrow">A SMALL DAILY PRACTICE</span><h2 id="help-title">Listen. Pause. Make it yours.</h2>
    <p>Shadowing means repeating Japanese just after you hear it. Take one sentence at a time. Match the rhythm, then try again.</p>
    <div className="help-steps"><div><Headphones /><strong>Listen closely</strong><span>Hear a short section at your own pace.</span></div><div><Mic /><strong>Take your turn</strong><span>The source pauses. Repeat the Japanese aloud.</span></div><div><Repeat2 /><strong>Make it stick</strong><span>Replay, compare, and continue when you’re ready.</span></div></div>
    {player ? <div className="shortcut-grid">{[['Space', 'Play / pause'], ['R', 'Replay section'], ['Enter', 'Continue'], ['← / →', 'Previous / next'], ['T', 'Translation']].map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}</div> : <p className="small muted">Start with the built-in sample, paste a YouTube link, or import your own media and subtitles. No account needed.</p>}
    <button className="button primary full-width" onClick={onClose}>Got it <ArrowUpRight size={17} /></button>
  </dialog>;
}
