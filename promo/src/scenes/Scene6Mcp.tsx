import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, ANSI } from '../constants';
import { FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import { TerminalWindow } from '../utils/terminal';
import type { SceneProps } from '../types';

// Tighter timing: scene is only 60 frames (2s)
// cmdDone = 13 chars * 2 frames = 26
// MCP lines need to appear faster
const MCP_LINES = [
  { text: 'MCP Server started (stdio)', color: ANSI.green, delay: 0 },
  { text: 'Tools: search_knowledge, get_note, list_notes, get_relations', color: ANSI.gray, delay: 4 },
  { text: '', color: ANSI.white, delay: 7 },
  { text: '> Claude Code is now connected.', color: ANSI.cyan, delay: 10 },
  { text: '> "What do we know about connection pooling?"', color: ANSI.white, delay: 16 },
  { text: '  \u2192 Returning 2 crystallized notes...', color: ANSI.green, delay: 22 },
];

export const Scene6Mcp: React.FC<SceneProps> = ({ variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Faster typing: 1 frame per char so command finishes at frame 13
  const cmdText = getTypedText({ frame, text: '$ crystal mcp', charFrames: 1 });
  const cmdDone = '$ crystal mcp'.length * 1; // frame 13

  const visibleLines = MCP_LINES.filter((line) => frame >= cmdDone + line.delay);

  // Loop diagram appears at frame 40, fully visible by frame 48
  const loopOpacity = interpolate(
    frame,
    [40, 48],
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
      {variant === 'B' ? (
        <div style={{ display: 'flex', width: '90%', gap: 24, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <TerminalWindow variant={variant} fullWidth>
              <div>
                <div style={{ color: ANSI.white }}>
                  {cmdText}
                  {frame < cmdDone && <Cursor frame={frame} />}
                </div>
                {visibleLines.map((line, i) => (
                  <div key={i} style={{ color: line.color, marginTop: 2 }}>
                    {line.text}
                  </div>
                ))}
              </div>
            </TerminalWindow>
          </div>
          {/* Feedback loop diagram */}
          <div
            style={{
              flex: 0.5,
              opacity: loopOpacity,
              textAlign: 'center',
              fontFamily: FONT_SANS,
              fontSize: 13,
              color: BRAND.white,
              lineHeight: 2.2,
            }}
          >
            <div style={{ color: BRAND.lavender, fontWeight: 700, fontSize: 14 }}>
              AI Conversations
            </div>
            <div style={{ color: BRAND.cobaltBlue }}>↓</div>
            <div style={{ color: BRAND.lavender, fontWeight: 700, fontSize: 14 }}>
              Crystallize
            </div>
            <div style={{ color: BRAND.cobaltBlue }}>↓</div>
            <div style={{ color: BRAND.lavender, fontWeight: 700, fontSize: 14 }}>
              Knowledge
            </div>
            <div style={{ color: BRAND.cobaltBlue }}>↓</div>
            <div style={{ color: BRAND.lavender, fontWeight: 700, fontSize: 14 }}>
              Feed back to AI ↩
            </div>
          </div>
        </div>
      ) : (
        <TerminalWindow variant={variant}>
          <div>
            <div style={{ color: ANSI.white }}>
              {cmdText}
              {frame < cmdDone && <Cursor frame={frame} />}
            </div>
            {visibleLines.map((line, i) => (
              <div key={i} style={{ color: line.color, marginTop: 2 }}>
                {line.text}
              </div>
            ))}
            {frame >= 40 && (
              <div style={{ marginTop: 12, color: BRAND.lavender, fontSize: 14, opacity: loopOpacity }}>
                {'  AI Conversations ───→ Crystallize ───→ Knowledge ───→ Feed back to AI ↩'}
              </div>
            )}
          </div>
        </TerminalWindow>
      )}
    </AbsoluteFill>
  );
};
