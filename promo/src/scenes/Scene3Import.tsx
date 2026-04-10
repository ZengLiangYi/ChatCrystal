import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow, getSpinnerChar } from '../utils/terminal';
import type { SceneProps } from '../types';

const SOURCES = [
  { name: 'Claude Code', count: 128, color: SOURCE_COLORS.claudeCode },
  { name: 'Codex CLI', count: 43, color: SOURCE_COLORS.codex },
  { name: 'Cursor', count: 87, color: SOURCE_COLORS.cursor },
];

export const Scene3Import: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cmdText = getTypedText({ frame, text: '$ crystal import', charFrames: 1 });
  const cmdDone = '$ crystal import'.length * 1;

  const scanStart = cmdDone + 5;
  const scanText = frame >= scanStart ? 'Scanning sources...' : '';

  const sourceLines = SOURCES.map((source, i) => {
    const sourceStart = scanStart + 10 + i * 12;
    const spinnerEnd = sourceStart + 8;

    if (frame < sourceStart) return null;

    const isDone = frame >= spinnerEnd;
    const prefix = isDone ? '  \u2713' : `  ${getSpinnerChar(frame)}`;
    const text = `${source.name}  \u2014 ${source.count} conversations found`;

    return { prefix, text, color: source.color, isDone };
  });

  const allDoneFrame = scanStart + 10 + SOURCES.length * 12;
  const totalText = frame >= allDoneFrame ? 'Imported 258 conversations.' : '';

  const totalOpacity = interpolate(
    frame,
    [allDoneFrame, allDoneFrame + 8],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: variant === 'A' ? BRAND.terminalBg : BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <TerminalWindow variant={variant}>
        <div>
          <div style={{ color: ANSI.white }}>
            {cmdText}
            {frame < cmdDone && <Cursor frame={frame} />}
          </div>
          {scanText && (
            <div style={{ color: ANSI.gray, marginTop: 8 }}>{scanText}</div>
          )}
          {sourceLines.map(
            (line, i) =>
              line && (
                <div key={i} style={{ marginTop: 4 }}>
                  <span style={{ color: line.isDone ? ANSI.green : ANSI.yellow }}>
                    {line.prefix}
                  </span>{' '}
                  <span style={{ color: line.color }}>{line.text}</span>
                </div>
              ),
          )}
          {totalText && (
            <div
              style={{
                marginTop: 12,
                color: ANSI.brightWhite,
                fontWeight: 700,
                opacity: totalOpacity,
              }}
            >
              {totalText}
            </div>
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
