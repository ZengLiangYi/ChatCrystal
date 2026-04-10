import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, ANSI } from '../constants';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow } from '../utils/terminal';
import type { SceneProps } from '../types';

const RESULTS = [
  {
    rank: '#1',
    title: 'Fix Redis connection pool leak',
    score: 0.94,
    summary: '"Root cause: connections not released\n       after timeout. Solution: add finally\n       block in pool.acquire()..."',
  },
  { rank: '#2', title: 'Node.js stream backpressure issue', score: 0.81, summary: null },
  { rank: '#3', title: 'SQLite WAL checkpoint tuning', score: 0.72, summary: null },
];

const scoreColor = (score: number): string => {
  if (score >= 0.9) return '#4ADE80';
  if (score >= 0.8) return '#F59E0B';
  return '#5C5F6E';
};

export const Scene5Search: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const query = '$ crystal search "how did I fix the memory leak"';
  const cmdText = getTypedText({ frame, text: query, charFrames: 1 });
  const cmdDone = query.length * 1;

  const thinkEnd = cmdDone + 8;
  const headerText = frame >= thinkEnd ? 'Found 3 related notes:' : '';

  const resultLines = RESULTS.map((result, i) => {
    const resultStart = thinkEnd + 8 + i * 12;
    if (frame < resultStart) return null;

    const fadeIn = interpolate(frame, [resultStart, resultStart + 6], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    return { ...result, opacity: fadeIn };
  });

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
          {headerText && (
            <div style={{ color: ANSI.gray, marginTop: 12 }}>{headerText}</div>
          )}
          {resultLines.map(
            (r, i) =>
              r && (
                <div key={i} style={{ marginTop: i === 0 ? 12 : 6, opacity: r.opacity }}>
                  <div>
                    <span style={{ color: ANSI.gray }}>  {r.rank}  </span>
                    <span style={{ color: ANSI.white, fontWeight: 700 }}>{r.title}</span>
                    <span style={{ color: scoreColor(r.score), marginLeft: 16 }}>
                      {r.score.toFixed(2)}
                    </span>
                  </div>
                  {r.summary && (
                    <div
                      style={{
                        color: BRAND.dimWhite,
                        marginLeft: 40,
                        marginTop: 2,
                        whiteSpace: 'pre',
                        fontSize: 14,
                      }}
                    >
                      {r.summary}
                    </div>
                  )}
                </div>
              ),
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
