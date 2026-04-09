import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow, getSpinnerChar } from '../utils/terminal';

const SOURCES = [
  { name: 'Claude Code', count: 128, color: SOURCE_COLORS.claudeCode },
  { name: 'Codex CLI', count: 43, color: SOURCE_COLORS.codex },
  { name: 'Cursor', count: 87, color: SOURCE_COLORS.cursor },
];

const SEARCH_RESULTS = [
  { rank: '1', title: 'JWT middleware implementation guide', score: 0.94, source: 'Claude Code', sourceColor: SOURCE_COLORS.claudeCode },
  { rank: '2', title: 'Auth token refresh flow', score: 0.87, source: 'Cursor', sourceColor: SOURCE_COLORS.cursor },
  { rank: '3', title: 'Session management patterns', score: 0.72, source: 'Codex', sourceColor: SOURCE_COLORS.codex },
];

const NOTE_LINES = [
  { label: 'Title:', value: 'JWT middleware implementation guide', color: ANSI.brightWhite },
  { label: 'Summary:', value: 'Implemented JWT verification middleware with', color: BRAND.dimWhite },
  { label: '', value: '         refresh token rotation and Redis blacklist.', color: BRAND.dimWhite },
  { label: 'Key conclusions:', value: '', color: BRAND.lavender },
  { label: '  •', value: 'Use RS256 for production, HS256 for dev', color: BRAND.lavender },
  { label: '  •', value: 'Store refresh tokens in Redis with 7d TTL', color: BRAND.lavender },
  { label: 'Tags:', value: 'auth, jwt, middleware, security', color: ANSI.cyan },
];

// Taller terminal for the longer showcase (12s of content)
const FIXED_HEIGHT = 320;

export const LandingCliShowcase: React.FC = () => {
  const frame = useCurrentFrame();

  // === Block 1: crystal import (0-90 / 0-3s) ===
  const cmd1 = '$ crystal import';
  const cmd1Text = getTypedText({ frame, text: cmd1, charFrames: 1 });
  const cmd1Done = cmd1.length;

  const scanStart = cmd1Done + 5;
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

  // === Block 2: crystal search (105-195 / 3.5-6.5s) ===
  const block2Start = 105;
  const cmd2 = '$ crystal search "JWT authentication"';
  const cmd2Text = frame >= block2Start
    ? getTypedText({ frame, text: cmd2, charFrames: 1, startFrame: block2Start })
    : '';
  const cmd2Done = block2Start + cmd2.length;

  const searchHeaderFrame = cmd2Done + 6;
  const searchHeader = frame >= searchHeaderFrame ? 'Found 3 related notes:' : '';

  const searchResults = SEARCH_RESULTS.map((r, i) => {
    const start = searchHeaderFrame + 6 + i * 10;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 6], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return { ...r, opacity: fadeIn };
  });

  // === Block 3: crystal notes get (210-315 / 7-10.5s) ===
  const block3Start = 210;
  const cmd3 = '$ crystal notes get abc123';
  const cmd3Text = frame >= block3Start
    ? getTypedText({ frame, text: cmd3, charFrames: 1, startFrame: block3Start })
    : '';
  const cmd3Done = block3Start + cmd3.length;

  const noteLines = NOTE_LINES.map((line, i) => {
    const start = cmd3Done + 6 + i * 5;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 5], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return { ...line, opacity: fadeIn };
  });

  // Fade out (340-360)
  const fadeOut = interpolate(frame, [340, 360], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Scroll calculation:
  // Visible content area = fixedHeight(320) - padding(48) = 272px
  // Block 1 ≈ 180px (fits), Block 2 adds ≈ 140px (total 320, overflow ~48px)
  // Block 3 adds ≈ 200px (total 520, overflow ~248px)
  // Scroll just enough that current block's last line + 24px margin is visible
  const scrollY = interpolate(
    frame,
    [block2Start, block2Start + 15, block3Start, block3Start + 15],
    [0, -100, -100, -270],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

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
          {/* Block 1: import */}
          <div style={{ color: ANSI.white }}>
            {cmd1Text}
            {frame < cmd1Done && <Cursor frame={frame} />}
          </div>
          {scanText && <div style={{ color: ANSI.gray, marginTop: 4 }}>{scanText}</div>}
          {sourceLines.map((s, i) =>
            s && (
              <div key={`src${i}`} style={{ marginTop: 2 }}>
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

          {/* Block 2: search */}
          {frame >= block2Start && (
            <>
              <div style={{ marginTop: 16, color: ANSI.white }}>
                {cmd2Text}
                {frame >= block2Start && frame < cmd2Done && <Cursor frame={frame} />}
              </div>
              {searchHeader && <div style={{ color: ANSI.gray, marginTop: 6 }}>{searchHeader}</div>}
              {searchResults.map((r, i) =>
                r && (
                  <div key={`r${i}`} style={{ marginTop: 4, opacity: r.opacity }}>
                    <span style={{ color: ANSI.cyan }}>  #{r.rank}  </span>
                    <span style={{ color: ANSI.white, fontWeight: 700 }}>{r.title}</span>
                    <span style={{ color: r.score >= 0.9 ? ANSI.green : r.score >= 0.8 ? ANSI.yellow : ANSI.gray, marginLeft: 12 }}>
                      {r.score.toFixed(2)}
                    </span>
                    <span style={{ color: r.sourceColor, marginLeft: 8, fontSize: 12 }}>[{r.source}]</span>
                  </div>
                )
              )}
            </>
          )}

          {/* Block 3: notes get */}
          {frame >= block3Start && (
            <>
              <div style={{ marginTop: 16, color: ANSI.white }}>
                {cmd3Text}
                {frame >= block3Start && frame < cmd3Done && <Cursor frame={frame} />}
              </div>
              {noteLines.map((line, i) =>
                line && (
                  <div key={`n${i}`} style={{ marginTop: 2, opacity: line.opacity }}>
                    {line.label && <span style={{ color: ANSI.gray }}>{line.label} </span>}
                    <span style={{ color: line.color }}>{line.value}</span>
                  </div>
                )
              )}
            </>
          )}

          {/* Bottom spacer — ensures last content has breathing room before clip edge */}
          <div style={{ height: 24 }} />
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
