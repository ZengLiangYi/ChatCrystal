import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow, getSpinnerChar } from '../utils/terminal';

// --- Segment 1: crystal import ---

const SOURCES = [
  { name: 'Claude Code', count: 128, color: SOURCE_COLORS.claudeCode },
  { name: 'Codex CLI', count: 43, color: SOURCE_COLORS.codex },
  { name: 'Cursor', count: 87, color: SOURCE_COLORS.cursor },
];

const SegmentImport: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal import';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const scanStart = cmdDone + 5;
  const scanText = frame >= scanStart ? 'Scanning sources...' : '';

  const sourceLines = SOURCES.map((source, i) => {
    const start = scanStart + 8 + i * 10;
    const spinnerEnd = start + 8;
    if (frame < start) return null;
    const isDone = frame >= spinnerEnd;
    const prefix = isDone ? '✓' : getSpinnerChar(frame);
    return { ...source, prefix, isDone };
  });

  const importDoneFrame = scanStart + 8 + SOURCES.length * 10;
  const importTotal = frame >= importDoneFrame ? 'Imported 258 conversations.' : '';
  const importTotalOpacity = interpolate(frame, [importDoneFrame, importDoneFrame + 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {scanText && <div style={{ color: ANSI.gray, marginTop: 4 }}>{scanText}</div>}
          {sourceLines.map((s, i) =>
            s && (
              <div key={i} style={{ marginTop: 2 }}>
                <span style={{ color: s.isDone ? ANSI.green : ANSI.yellow }}>  {s.prefix} </span>
                <span style={{ color: s.color }}>{s.name}</span>
                <span style={{ color: ANSI.gray }}> — {s.count} conversations</span>
              </div>
            )
          )}
          {importTotal && (
            <div style={{ marginTop: 6, color: ANSI.brightWhite, fontWeight: 700, opacity: importTotalOpacity }}>
              {importTotal}
            </div>
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Segment 2: crystal search ---

const SEARCH_RESULTS = [
  { rank: '1', title: 'JWT middleware implementation guide', score: 0.94, source: 'Claude Code', sourceColor: SOURCE_COLORS.claudeCode },
  { rank: '2', title: 'Auth token refresh flow', score: 0.87, source: 'Cursor', sourceColor: SOURCE_COLORS.cursor },
  { rank: '3', title: 'Session management patterns', score: 0.72, source: 'Codex', sourceColor: SOURCE_COLORS.codex },
];

const SegmentSearch: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal search "JWT authentication"';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const headerFrame = cmdDone + 6;
  const headerText = frame >= headerFrame ? 'Found 3 related notes:' : '';

  const results = SEARCH_RESULTS.map((r, i) => {
    const start = headerFrame + 6 + i * 10;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 6], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return { ...r, opacity: fadeIn };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {headerText && <div style={{ color: ANSI.gray, marginTop: 6 }}>{headerText}</div>}
          {results.map((r, i) =>
            r && (
              <div key={i} style={{ marginTop: 4, opacity: r.opacity }}>
                <span style={{ color: ANSI.cyan }}>  #{r.rank}  </span>
                <span style={{ color: ANSI.white, fontWeight: 700 }}>{r.title}</span>
                <span style={{ color: r.score >= 0.9 ? ANSI.green : r.score >= 0.8 ? ANSI.yellow : ANSI.gray, marginLeft: 12 }}>
                  {r.score.toFixed(2)}
                </span>
                <span style={{ color: r.sourceColor, marginLeft: 8, fontSize: 12 }}>[{r.source}]</span>
              </div>
            )
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Segment 3: crystal notes get ---

const NOTE_LINES = [
  { label: 'Title:', value: 'JWT middleware implementation guide', color: ANSI.brightWhite },
  { label: 'Summary:', value: 'Implemented JWT verification middleware with', color: BRAND.dimWhite },
  { label: '', value: '         refresh token rotation and Redis blacklist.', color: BRAND.dimWhite },
  { label: 'Key conclusions:', value: '', color: BRAND.lavender },
  { label: '  •', value: 'Use RS256 for production, HS256 for dev', color: BRAND.lavender },
  { label: '  •', value: 'Store refresh tokens in Redis with 7d TTL', color: BRAND.lavender },
  { label: 'Tags:', value: 'auth, jwt, middleware, security', color: ANSI.cyan },
];

const SegmentNotes: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal notes get abc123';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const noteLines = NOTE_LINES.map((line, i) => {
    const start = cmdDone + 6 + i * 5;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 5], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return { ...line, opacity: fadeIn };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {noteLines.map((line, i) =>
            line && (
              <div key={i} style={{ marginTop: 2, opacity: line.opacity }}>
                {line.label && <span style={{ color: ANSI.gray }}>{line.label} </span>}
                <span style={{ color: line.color }}>{line.value}</span>
              </div>
            )
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Main composition: 3 segments with fade transitions ---
// Total: 360 frames (12s). Transition: 12 frames each.
// 3 segments + 2 transitions. Effective: seg1 + seg2 + seg3 - 2*12 = 360
// So seg1 + seg2 + seg3 = 384. Distribute: 110 + 120 + 154

const TRANSITION_FRAMES = 12;

export const LandingCliShowcase: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={110}>
        <SegmentImport />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={120}>
        <SegmentSearch />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={154}>
        <SegmentNotes />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
