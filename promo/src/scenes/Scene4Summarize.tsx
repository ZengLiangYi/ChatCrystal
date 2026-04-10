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

const NOTES = [
  {
    title: '"Fix Redis connection pool leak"',
    tags: ['redis', 'connection-pool', 'bug-fix'],
  },
  {
    title: '"Implement JWT refresh token rotation"',
    tags: ['auth', 'jwt', 'security'],
  },
];

export const Scene4Summarize: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cmdText = getTypedText({ frame, text: '$ crystal summarize --all', charFrames: 1 });
  const cmdDone = '$ crystal summarize --all'.length * 1;

  const crystStart = cmdDone + 5;
  const crystText = frame >= crystStart ? 'Crystallizing 258 conversations...' : '';

  const progressStart = crystStart + 6;
  const progressEnd = progressStart + 1.5 * fps;
  const progress = interpolate(frame, [progressStart, progressEnd], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const barWidth = 24;
  const filled = Math.round((progress / 100) * barWidth);
  const progressBar = `[${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}] ${Math.round(progress)}%`;

  const noteLines = NOTES.map((note, i) => {
    const noteStart = progressStart + (i + 1) * 18;
    if (frame < noteStart) return null;

    const tagStr = note.tags.join(', ');
    return { title: note.title, tags: tagStr };
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
          {crystText && (
            <div style={{ color: ANSI.gray, marginTop: 8 }}>{crystText}</div>
          )}
          {frame >= progressStart && (
            <div style={{ color: BRAND.lavender, marginTop: 4 }}>  {progressBar}</div>
          )}
          {noteLines.map(
            (note, i) =>
              note && (
                <div key={i} style={{ marginTop: 8 }}>
                  <div style={{ color: ANSI.green }}>
                    {'  \u2713 '}<span style={{ color: ANSI.white }}>{note.title}</span>
                  </div>
                  <div style={{ color: BRAND.lavender, marginLeft: 24 }}>
                    {variant === 'A' ? `#${note.tags.split(', ').join(' #')}` : `Tags: ${note.tags}`}
                  </div>
                </div>
              ),
          )}
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
