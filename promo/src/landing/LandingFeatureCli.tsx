import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { BRAND, ANSI } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow } from '../utils/terminal';

// --- Segment 1: crystal status ---

const STATUS_LINES = [
  { text: '  Server:        running on :3721', color: ANSI.green },
  { text: '  Conversations: 258', color: ANSI.cyan },
  { text: '  Notes:         142', color: ANSI.cyan },
  { text: '  Sources:       3 (Claude Code, Codex, Cursor)', color: ANSI.cyan },
];

const SegmentStatus: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal status';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const statusLines = STATUS_LINES.map((line, i) => {
    const start = cmdDone + 4 + i * 4;
    return frame >= start ? line : null;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {statusLines.map((line, i) =>
            line && <div key={i} style={{ color: line.color, marginTop: 2 }}>{line.text}</div>
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Segment 2: crystal tags ---

const TAGS = [
  { name: 'auth', count: 12, color: ANSI.green },
  { name: 'api', count: 9, color: ANSI.yellow },
  { name: 'database', count: 7, color: ANSI.blue },
  { name: 'testing', count: 5, color: ANSI.cyan },
  { name: 'deploy', count: 4, color: ANSI.purple },
];

const SegmentTags: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal tags';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const tagLines = TAGS.map((tag, i) => {
    const start = cmdDone + 4 + i * 4;
    return frame >= start ? tag : null;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {tagLines.map((tag, i) =>
            tag && (
              <div key={i} style={{ marginTop: 2 }}>
                <span style={{ color: tag.color }}>  {tag.name}</span>
                <span style={{ color: ANSI.gray }}>{' '.repeat(12 - tag.name.length)}{tag.count} notes</span>
              </div>
            )
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Segment 3: crystal summarize --all ---

const SegmentSummarize: React.FC = () => {
  const frame = useCurrentFrame();
  const cmd = '$ crystal summarize --all';
  const cmdText = getTypedText({ frame, text: cmd, charFrames: 1 });
  const cmdDone = cmd.length;

  const progressStart = cmdDone + 6;
  const progressEnd = progressStart + 24;
  const progressPct = interpolate(frame, [progressStart, progressEnd], [0, 100], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const progressDone = frame >= progressEnd;

  return (
    <AbsoluteFill style={{ backgroundColor: BRAND.bg, justifyContent: 'center', alignItems: 'center' }}>
      <TerminalWindow variant="B">
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {frame >= progressStart && !progressDone && (
            <div style={{ marginTop: 4 }}>
              <span style={{ color: ANSI.gray }}>  Summarizing... </span>
              <span style={{ color: BRAND.purple }}>{'█'.repeat(Math.floor(progressPct / 5))}</span>
              <span style={{ color: ANSI.gray }}>{'░'.repeat(20 - Math.floor(progressPct / 5))}</span>
              <span style={{ color: ANSI.cyan }}> {Math.floor(progressPct)}%</span>
            </div>
          )}
          {progressDone && (
            <div style={{ marginTop: 4, color: ANSI.green }}>
              {'  ✓ 15 notes generated'}
            </div>
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};

// --- Main composition: 3 segments with fade transitions ---
// Segment durations: 54 + 54 + 57 = 165, minus 2 transitions of 10 = 145
// Pad remaining frames (180 - 145 = 35) into segment 3 for hold time

const TRANSITION_FRAMES = 10;

export const LandingFeatureCli: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={54}>
        <SegmentStatus />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={54}>
        <SegmentTags />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence durationInFrames={92}>
        <SegmentSummarize />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
