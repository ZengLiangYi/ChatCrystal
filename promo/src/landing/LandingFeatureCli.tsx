import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, ANSI } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow } from '../utils/terminal';

const STATUS_LINES = [
  { text: '  Server:        running on :3721', color: ANSI.green },
  { text: '  Conversations: 258', color: ANSI.cyan },
  { text: '  Notes:         142', color: ANSI.cyan },
  { text: '  Sources:       3 (Claude Code, Codex, Cursor)', color: ANSI.cyan },
];

const TAGS = [
  { name: 'auth', count: 12, color: ANSI.green },
  { name: 'api', count: 9, color: ANSI.yellow },
  { name: 'database', count: 7, color: ANSI.blue },
  { name: 'testing', count: 5, color: ANSI.cyan },
  { name: 'deploy', count: 4, color: ANSI.purple },
];

// TerminalWindow padding is 24px top+bottom. fixedHeight includes that padding.
// Visible content area = fixedHeight - 48px (padding). We use 300 so visible = 252px.
const FIXED_HEIGHT = 300;

export const LandingFeatureCli: React.FC = () => {
  const frame = useCurrentFrame();

  // --- Block 1: crystal status (0-54 frames) ---
  const cmd1 = '$ crystal status';
  const cmd1Text = getTypedText({ frame, text: cmd1, charFrames: 1 });
  const cmd1Done = cmd1.length;

  const statusLines = STATUS_LINES.map((line, i) => {
    const start = cmd1Done + 4 + i * 4;
    return frame >= start ? line : null;
  });

  // --- Block 2: crystal tags (54-108 frames) ---
  const block2Start = 54;
  const cmd2 = '$ crystal tags';
  const cmd2Text = frame >= block2Start
    ? getTypedText({ frame, text: cmd2, charFrames: 1, startFrame: block2Start })
    : '';
  const cmd2Done = block2Start + cmd2.length;

  const tagLines = TAGS.map((tag, i) => {
    const start = cmd2Done + 4 + i * 4;
    return frame >= start ? tag : null;
  });

  // --- Block 3: crystal summarize --all (108-165 frames) ---
  const block3Start = 108;
  const cmd3 = '$ crystal summarize --all';
  const cmd3Text = frame >= block3Start
    ? getTypedText({ frame, text: cmd3, charFrames: 1, startFrame: block3Start })
    : '';
  const cmd3Done = block3Start + cmd3.length;

  const progressStart = cmd3Done + 6;
  const progressEnd = progressStart + 24;
  const progressPct = interpolate(
    frame,
    [progressStart, progressEnd],
    [0, 100],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const progressDone = frame >= progressEnd;

  // Scroll: keep ~24px bottom margin for the last visible content
  // Block 1 ≈ 130px, Block 2 adds ≈ 150px (total 280), Block 3 adds ≈ 60px (total 340)
  // Visible area ≈ 252px. We scroll just enough to show the active block + padding.
  const scrollY = interpolate(
    frame,
    [block2Start, block2Start + 12, block3Start, block3Start + 12],
    [0, -50, -50, -110],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Fade out (165-180)
  const fadeOut = interpolate(frame, [165, 180], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <TerminalWindow variant="B" fixedHeight={FIXED_HEIGHT}>
        <div style={{ transform: `translateY(${scrollY}px)` }}>
          {/* Block 1: status */}
          <div style={{ color: ANSI.white }}>
            {cmd1Text}
            {frame < cmd1Done && <Cursor frame={frame} />}
          </div>
          {statusLines.map((line, i) =>
            line && <div key={`s${i}`} style={{ color: line.color, marginTop: 2 }}>{line.text}</div>
          )}

          {/* Block 2: tags */}
          {frame >= block2Start && (
            <>
              <div style={{ marginTop: 14, color: ANSI.white }}>
                {cmd2Text}
                {frame >= block2Start && frame < cmd2Done && <Cursor frame={frame} />}
              </div>
              {tagLines.map((tag, i) =>
                tag && (
                  <div key={`t${i}`} style={{ marginTop: 2 }}>
                    <span style={{ color: tag.color }}>  {tag.name}</span>
                    <span style={{ color: ANSI.gray }}>{' '.repeat(12 - tag.name.length)}{tag.count} notes</span>
                  </div>
                )
              )}
            </>
          )}

          {/* Block 3: summarize */}
          {frame >= block3Start && (
            <>
              <div style={{ marginTop: 14, color: ANSI.white }}>
                {cmd3Text}
                {frame >= block3Start && frame < cmd3Done && <Cursor frame={frame} />}
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
            </>
          )}

          {/* Bottom spacer — ensures last content isn't clipped by overflow:hidden */}
          <div style={{ height: 24 }} />
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
