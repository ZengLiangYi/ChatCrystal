# Landing Page Remotion Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create 5 Remotion compositions for the ChatCrystal landing page, render them to WebM + MP4, and place outputs in `site/public/demos/`.

**Architecture:** New compositions in `promo/src/landing/` directory, all using Variant B (macOS window). Reuse existing utils (`getTypedText`, `Cursor`, `TerminalWindow`, `getSpinnerChar`) and constants (`BRAND`, `ANSI`, `SOURCE_COLORS`). Register all compositions in `Root.tsx` under a "Landing" folder. Render via a new `render-landing.sh` script.

**Tech Stack:** Remotion 4.0.261, React 19, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-08-landing-animations-design.md`

**Existing code to reuse:**
- `promo/src/constants.ts` — BRAND, ANSI, SOURCE_COLORS, TYPEWRITER, SPINNER_CHARS
- `promo/src/utils/typewriter.ts` — `getTypedText()`, `Cursor`
- `promo/src/utils/terminal.ts` — `TerminalWindow` (variant='B'), `getSpinnerChar()`
- `promo/src/fonts.ts` — `FONT_MONO`, `FONT_SANS`
- `promo/src/types.ts` — `Variant`, `SceneProps`

---

## File Structure

```
promo/src/landing/
├── LandingFeatureCli.tsx       # Task 1: CLI commands demo (6s)
├── LandingFeatureSearch.tsx     # Task 2: Semantic search demo (5s)
├── LandingFeatureMcp.tsx        # Task 3: MCP integration demo (5s)
├── LandingCliShowcase.tsx       # Task 4: Full CLI workflow (12s)
├── LandingHero.tsx              # Task 5: Core flow — conversation → note (10s)
promo/src/Root.tsx               # Task 6: Register landing compositions
promo/render-landing.sh          # Task 6: Render script
```

---

### Task 1: LandingFeatureCli

**Files:**
- Create: `promo/src/landing/LandingFeatureCli.tsx`

- [ ] **Step 1: Create `promo/src/landing/LandingFeatureCli.tsx`**

```tsx
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

export const LandingFeatureCli: React.FC = () => {
  const frame = useCurrentFrame();

  // --- Block 1: crystal status (0-54 frames / 0-1.8s) ---
  const cmd1 = '$ crystal status';
  const cmd1Text = getTypedText({ frame, text: cmd1, charFrames: 1 });
  const cmd1Done = cmd1.length; // frame 16

  const statusLines = STATUS_LINES.map((line, i) => {
    const start = cmd1Done + 4 + i * 4;
    return frame >= start ? line : null;
  });

  // --- Block 2: crystal tags (54-108 frames / 1.8-3.6s) ---
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

  // --- Block 3: crystal summarize --all (108-165 frames / 3.6-5.5s) ---
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

  // --- Fade out (165-180) ---
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
      <TerminalWindow variant="B">
        <div>
          {/* Block 1 */}
          <div style={{ color: ANSI.white }}>
            {cmd1Text}
            {frame < cmd1Done && <Cursor frame={frame} />}
          </div>
          {statusLines.map((line, i) =>
            line && <div key={`s${i}`} style={{ color: line.color, marginTop: 2 }}>{line.text}</div>
          )}

          {/* Block 2 */}
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

          {/* Block 3 */}
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
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify in Remotion Studio**

```bash
cd promo && npx remotion studio
```

Open browser, find LandingFeatureCli in the sidebar (after Task 6 registers it). For now, just confirm the file compiles: `npx tsc --noEmit promo/src/landing/LandingFeatureCli.tsx` (may need Root registration first).

- [ ] **Step 3: Commit**

```bash
git add promo/src/landing/LandingFeatureCli.tsx
git commit -m "feat(promo): add LandingFeatureCli composition"
```

---

### Task 2: LandingFeatureSearch

**Files:**
- Create: `promo/src/landing/LandingFeatureSearch.tsx`

- [ ] **Step 1: Create `promo/src/landing/LandingFeatureSearch.tsx`**

```tsx
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';

const RESULTS = [
  {
    title: 'JWT refresh token rotation strategy',
    summary: 'Implemented sliding window rotation with…',
    highlight: 'JWT refresh tokens',
    score: 0.94,
    source: 'Claude Code',
    sourceColor: SOURCE_COLORS.claudeCode,
  },
  {
    title: 'Auth middleware token validation',
    summary: 'Added expiry check and refresh logic in…',
    highlight: 'token',
    score: 0.87,
    source: 'Cursor',
    sourceColor: SOURCE_COLORS.cursor,
  },
  {
    title: 'Session management with Redis',
    summary: 'Store refresh tokens in Redis with TTL…',
    highlight: 'refresh tokens',
    score: 0.72,
    source: 'Codex',
    sourceColor: SOURCE_COLORS.codex,
  },
];

const scoreColor = (score: number): string => {
  if (score >= 0.9) return '#4ADE80';
  if (score >= 0.8) return '#F59E0B';
  return BRAND.muted;
};

export const LandingFeatureSearch: React.FC = () => {
  const frame = useCurrentFrame();

  // Search bar typing (0-45 frames)
  const query = 'How to handle JWT refresh tokens';
  const typedQuery = getTypedText({ frame, text: query, charFrames: 1 });
  const queryDone = query.length; // frame 31

  // Shimmer loading (45-60)
  const shimmerStart = 45;
  const showShimmer = frame >= shimmerStart && frame < 60;

  // Results appear (60-135)
  const results = RESULTS.map((r, i) => {
    const start = 60 + i * 20;
    if (frame < start) return null;
    const slideUp = interpolate(frame, [start, start + 10], [20, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const fadeIn = interpolate(frame, [start, start + 10], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { ...r, slideUp, fadeIn };
  });

  // Fade out (135-150)
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
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
      <div
        style={{
          width: '85%',
          maxWidth: 680,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Search bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              backgroundColor: '#1A1D28',
              borderRadius: 8,
              padding: '10px 14px',
              border: `1px solid ${BRAND.deepPurple}60`,
            }}
          >
            {/* Magnifying glass SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span style={{ fontFamily: FONT_SANS, fontSize: 15, color: BRAND.white }}>
              {typedQuery}
              {frame < queryDone && <Cursor frame={frame} />}
            </span>
          </div>

          {/* Shimmer loading */}
          {showShimmer && (
            <div style={{ marginTop: 16 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 48,
                    borderRadius: 8,
                    marginTop: i > 0 ? 8 : 0,
                    background: `linear-gradient(90deg, ${BRAND.terminalBg} 25%, #1A1D28 50%, ${BRAND.terminalBg} 75%)`,
                    backgroundSize: '200% 100%',
                    opacity: 0.6,
                  }}
                />
              ))}
            </div>
          )}

          {/* Results */}
          <div style={{ marginTop: 16 }}>
            {results.map((r, i) =>
              r && (
                <div
                  key={i}
                  style={{
                    opacity: r.fadeIn,
                    transform: `translateY(${r.slideUp}px)`,
                    padding: '12px 14px',
                    borderRadius: 8,
                    backgroundColor: `${BRAND.white}08`,
                    marginTop: i > 0 ? 8 : 0,
                    border: `1px solid ${BRAND.white}0A`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 600, color: BRAND.white }}>{r.title}</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: scoreColor(r.score) }}>{r.score.toFixed(2)}</span>
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 12, color: BRAND.dimWhite, marginTop: 4 }}>
                    {r.summary}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <span
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: 10,
                        color: r.sourceColor,
                        backgroundColor: `${r.sourceColor}20`,
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}
                    >
                      {r.source}
                    </span>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add promo/src/landing/LandingFeatureSearch.tsx
git commit -m "feat(promo): add LandingFeatureSearch composition"
```

---

### Task 3: LandingFeatureMcp

**Files:**
- Create: `promo/src/landing/LandingFeatureMcp.tsx`

- [ ] **Step 1: Create `promo/src/landing/LandingFeatureMcp.tsx`**

```tsx
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from 'remotion';
import { BRAND, ANSI } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';
import { getSpinnerChar } from '../utils/terminal';

const CODE_LINES = [
  { text: 'async function rateLimit(req, res, next) {', color: ANSI.cyan },
  { text: '  const key = req.ip;', color: ANSI.white },
  { text: '  const current = await redis.incr(key);', color: ANSI.white },
  { text: '  if (current > MAX_REQUESTS) {', color: ANSI.yellow },
  { text: '    return res.status(429).json({ error: "Too many requests" });', color: ANSI.red },
  { text: '  }', color: ANSI.white },
  { text: '}', color: ANSI.cyan },
];

export const LandingFeatureMcp: React.FC = () => {
  const frame = useCurrentFrame();

  // User message (0-45)
  const userMsg = 'How did we implement rate limiting?';
  const userText = getTypedText({ frame, text: userMsg, charFrames: 1 });
  const userDone = userMsg.length;

  // Tool call block (45-75)
  const toolStart = 45;
  const toolCallVisible = frame >= toolStart;
  const spinnerEnd = 75;
  const toolDone = frame >= spinnerEnd;

  // Results expand (75-120)
  const resultStart = 78;
  const summaryText = frame >= resultStart ? 'Rate limiting middleware using Redis INCR with per-IP keys' : '';

  const codeStart = resultStart + 10;
  const codeLines = CODE_LINES.map((line, i) => {
    const start = codeStart + i * 3;
    if (frame < start) return null;
    const fadeIn = interpolate(frame, [start, start + 4], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { ...line, opacity: fadeIn };
  });

  // Assistant summary (120-135)
  const assistantStart = 120;
  const assistantOpacity = interpolate(frame, [assistantStart, assistantStart + 8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out (135-150)
  const fadeOut = interpolate(frame, [135, 150], [1, 0], {
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
      <div
        style={{
          width: '85%',
          maxWidth: 680,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px', fontFamily: FONT_SANS, fontSize: 14 }}>
          {/* User message */}
          <div style={{ color: BRAND.dimWhite, fontSize: 12, marginBottom: 4 }}>You</div>
          <div style={{ color: BRAND.white }}>
            {userText}
            {frame < userDone && <Cursor frame={frame} />}
          </div>

          {/* Tool call block */}
          {toolCallVisible && (
            <div
              style={{
                marginTop: 16,
                border: `1px solid ${BRAND.cobaltBlue}60`,
                borderRadius: 8,
                padding: '10px 14px',
                backgroundColor: `${BRAND.cobaltBlue}10`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: toolDone ? ANSI.green : ANSI.yellow, fontFamily: FONT_MONO, fontSize: 13 }}>
                  {toolDone ? '✓' : getSpinnerChar(frame)}
                </span>
                <span style={{ color: BRAND.cobaltBlue, fontFamily: FONT_MONO, fontSize: 13 }}>
                  search_knowledge("rate limiting")
                </span>
              </div>

              {/* Expanded result */}
              {frame >= resultStart && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BRAND.cobaltBlue}30` }}>
                  <div style={{ color: BRAND.dimWhite, fontSize: 12 }}>{summaryText}</div>
                  {/* Code block */}
                  {frame >= codeStart && (
                    <div
                      style={{
                        marginTop: 8,
                        backgroundColor: BRAND.bg,
                        borderRadius: 6,
                        padding: '10px 12px',
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        lineHeight: 1.5,
                      }}
                    >
                      {codeLines.map((line, i) =>
                        line && (
                          <div key={i} style={{ color: line.color, opacity: line.opacity }}>{line.text}</div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Assistant response */}
          {frame >= assistantStart && (
            <div style={{ marginTop: 16, opacity: assistantOpacity }}>
              <div style={{ color: BRAND.dimWhite, fontSize: 12, marginBottom: 4 }}>Assistant</div>
              <div style={{ color: BRAND.lavender, fontSize: 13 }}>
                We used Redis INCR with per-IP keys and a 429 response when the limit is exceeded.
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add promo/src/landing/LandingFeatureMcp.tsx
git commit -m "feat(promo): add LandingFeatureMcp composition"
```

---

### Task 4: LandingCliShowcase

**Files:**
- Create: `promo/src/landing/LandingCliShowcase.tsx`

- [ ] **Step 1: Create `promo/src/landing/LandingCliShowcase.tsx`**

```tsx
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

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <TerminalWindow variant="B">
        <div>
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
        </div>
      </TerminalWindow>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add promo/src/landing/LandingCliShowcase.tsx
git commit -m "feat(promo): add LandingCliShowcase composition"
```

---

### Task 5: LandingHero

**Files:**
- Create: `promo/src/landing/LandingHero.tsx`

- [ ] **Step 1: Create `promo/src/landing/LandingHero.tsx`**

```tsx
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BRAND, ANSI, SOURCE_COLORS } from '../constants';
import { FONT_MONO, FONT_SANS } from '../fonts';
import { getTypedText, Cursor } from '../utils/typewriter';

const CONVERSATION = [
  { role: 'user', text: 'How should I implement JWT refresh tokens?' },
  { role: 'assistant', text: 'Use a sliding window rotation strategy. Store refresh tokens in Redis with a TTL...' },
  { role: 'user', text: 'What about token blacklisting?' },
  { role: 'assistant', text: 'Maintain a Redis SET of revoked token IDs. Check on each request with O(1) lookup...' },
];

const TAGS = [
  { label: 'auth', color: SOURCE_COLORS.claudeCode },
  { label: 'jwt', color: SOURCE_COLORS.codex },
  { label: 'security', color: SOURCE_COLORS.cursor },
];

export const LandingHero: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // === Phase 1: Conversation scroll (0-60 / 0-2s) ===
  const convLines = CONVERSATION.map((msg, i) => {
    const start = i * 12;
    if (frame < start) return null;
    const charsDone = Math.min(msg.text.length, Math.floor((frame - start) / 0.5));
    return { ...msg, text: msg.text.slice(0, charsDone) };
  });

  // === Phase 2: Import notification (60-90 / 2-3s) ===
  const importStart = 60;
  const importSlideIn = interpolate(frame, [importStart, importStart + 8], [60, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const importOpacity = interpolate(frame, [importStart, importStart + 8], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 3: Dissolve + Logo (90-150 / 3-5s) ===
  const dissolveStart = 90;
  const convOpacity = interpolate(frame, [dissolveStart, dissolveStart + 15], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const logoStart = 110;
  const logoSpring = spring({
    frame: Math.max(0, frame - logoStart),
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const logoScale = interpolate(logoSpring, [0, 1], [0.3, 1]);
  const logoOpacity = interpolate(logoSpring, [0, 1], [0, 1]);

  const crystText = frame >= 120 ? 'Crystallizing...' : '';
  const crystOpacity = interpolate(frame, [120, 128], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // === Phase 4: Note card (150-270 / 5-9s) ===
  const noteStart = 150;
  const logoShrink = interpolate(frame, [noteStart, noteStart + 15], [1, 0.5], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveX = interpolate(frame, [noteStart, noteStart + 15], [0, -220], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoMoveY = interpolate(frame, [noteStart, noteStart + 15], [0, -140], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const cardSlideIn = interpolate(frame, [noteStart + 10, noteStart + 25], [40, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const cardOpacity = interpolate(frame, [noteStart + 10, noteStart + 25], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Note content staggered reveal
  const titleFrame = noteStart + 20;
  const summaryFrame = noteStart + 35;
  const tagsFrame = noteStart + 50;
  const codeFrame = noteStart + 65;

  const titleOpacity = interpolate(frame, [titleFrame, titleFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const summaryOpacity = interpolate(frame, [summaryFrame, summaryFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tagsOpacity = interpolate(frame, [tagsFrame, tagsFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const codeOpacity = interpolate(frame, [codeFrame, codeFrame + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // === Phase 5: Fade out (270-300 / 9-10s) ===
  const fadeOut = interpolate(frame, [270, 300], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const showConversation = frame < dissolveStart + 15;
  const showLogo = frame >= logoStart;
  const showNote = frame >= noteStart + 10;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BRAND.bg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: fadeOut,
      }}
    >
      <div
        style={{
          width: '88%',
          maxWidth: 720,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          border: `1px solid ${BRAND.deepPurple}40`,
          backgroundColor: BRAND.terminalBg,
          minHeight: 340,
          position: 'relative',
        }}
      >
        {/* macOS title bar */}
        <div style={{ backgroundColor: '#1A1D28', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FF5F57' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#FEBC2E' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28C840' }} />
        </div>

        <div style={{ padding: '20px 24px', position: 'relative', minHeight: 300 }}>
          {/* Phase 1: Conversation */}
          {showConversation && (
            <div style={{ opacity: convOpacity, fontFamily: FONT_SANS, fontSize: 13 }}>
              {convLines.map((msg, i) =>
                msg && (
                  <div key={i} style={{ marginTop: i > 0 ? 10 : 0 }}>
                    <div style={{ color: msg.role === 'user' ? BRAND.dimWhite : BRAND.lavender, fontSize: 11, marginBottom: 2 }}>
                      {msg.role === 'user' ? 'You' : 'Assistant'}
                    </div>
                    <div style={{ color: msg.role === 'user' ? BRAND.white : BRAND.lavender }}>
                      {msg.text}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Import notification */}
          {frame >= importStart && frame < dissolveStart + 15 && (
            <div
              style={{
                position: 'absolute',
                bottom: 16,
                right: 16,
                backgroundColor: `${BRAND.deepPurple}E0`,
                borderRadius: 8,
                padding: '8px 14px',
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: ANSI.green,
                opacity: importOpacity,
                transform: `translateY(${importSlideIn}px)`,
              }}
            >
              ✓ crystal import — 1 conversation
            </div>
          )}

          {/* Phase 3: Logo + Crystallizing */}
          {showLogo && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(calc(-50% + ${frame >= noteStart ? logoMoveX : 0}px), calc(-50% + ${frame >= noteStart ? logoMoveY : 0}px)) scale(${frame >= noteStart ? logoShrink : logoScale})`,
                opacity: logoOpacity,
                textAlign: 'center',
              }}
            >
              <Img src={staticFile('logo.png')} style={{ width: 64, height: 64 }} />
              {crystText && frame < noteStart && (
                <div style={{ fontFamily: FONT_SANS, fontSize: 14, color: BRAND.lavender, marginTop: 8, opacity: crystOpacity }}>
                  {crystText}
                </div>
              )}
            </div>
          )}

          {/* Phase 4: Note card */}
          {showNote && (
            <div
              style={{
                opacity: cardOpacity,
                transform: `translateX(${cardSlideIn}px)`,
                marginLeft: 40,
                marginTop: 10,
              }}
            >
              <div style={{ opacity: titleOpacity, fontFamily: FONT_SANS, fontSize: 16, fontWeight: 700, color: BRAND.white }}>
                JWT Refresh Token Implementation
              </div>

              <div style={{ opacity: summaryOpacity, fontFamily: FONT_SANS, fontSize: 12, color: BRAND.dimWhite, marginTop: 8, lineHeight: 1.5 }}>
                Sliding window rotation with Redis-backed blacklist. RS256 for production, HS256 for dev. Refresh tokens stored with 7-day TTL.
              </div>

              <div style={{ opacity: tagsOpacity, marginTop: 10, display: 'flex', gap: 6 }}>
                {TAGS.map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 10,
                      color: tag.color,
                      backgroundColor: `${tag.color}20`,
                      padding: '2px 8px',
                      borderRadius: 4,
                    }}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>

              <div
                style={{
                  opacity: codeOpacity,
                  marginTop: 10,
                  backgroundColor: BRAND.bg,
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ color: ANSI.cyan }}>{'const verify = jwt.verify(token, publicKey, {'}</div>
                <div style={{ color: ANSI.white }}>{'  algorithms: ["RS256"]'}</div>
                <div style={{ color: ANSI.cyan }}>{'});'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add promo/src/landing/LandingHero.tsx
git commit -m "feat(promo): add LandingHero composition"
```

---

### Task 6: Register Compositions + Render Script

**Files:**
- Modify: `promo/src/Root.tsx`
- Create: `promo/render-landing.sh`

- [ ] **Step 1: Add landing compositions to `promo/src/Root.tsx`**

Add imports at the top of the file, after existing scene imports:

```tsx
import { LandingHero } from './landing/LandingHero';
import { LandingFeatureSearch } from './landing/LandingFeatureSearch';
import { LandingFeatureMcp } from './landing/LandingFeatureMcp';
import { LandingFeatureCli } from './landing/LandingFeatureCli';
import { LandingCliShowcase } from './landing/LandingCliShowcase';
```

Add a new `Folder` inside the `<>` fragment, after the existing `Scenes-B` folder:

```tsx
<Folder name="Landing">
  <Composition id="LandingHero" component={LandingHero} durationInFrames={300} fps={FPS} width={WIDTH} height={HEIGHT} />
  <Composition id="LandingFeatureSearch" component={LandingFeatureSearch} durationInFrames={150} fps={FPS} width={WIDTH} height={HEIGHT} />
  <Composition id="LandingFeatureMcp" component={LandingFeatureMcp} durationInFrames={150} fps={FPS} width={WIDTH} height={HEIGHT} />
  <Composition id="LandingFeatureCli" component={LandingFeatureCli} durationInFrames={180} fps={FPS} width={WIDTH} height={HEIGHT} />
  <Composition id="LandingCliShowcase" component={LandingCliShowcase} durationInFrames={360} fps={FPS} width={WIDTH} height={HEIGHT} />
</Folder>
```

- [ ] **Step 2: Create `promo/render-landing.sh`**

```bash
#!/bin/bash
# Renders landing page compositions to WebM + MP4
# Output: ../site/public/demos/
set -e

OUT_DIR="../site/public/demos"
mkdir -p "$OUT_DIR"

COMPOSITIONS=(
  "LandingHero:hero"
  "LandingFeatureSearch:feature-search"
  "LandingFeatureMcp:feature-mcp"
  "LandingFeatureCli:feature-cli"
  "LandingCliShowcase:cli-showcase"
)

for entry in "${COMPOSITIONS[@]}"; do
  ID="${entry%%:*}"
  NAME="${entry##*:}"

  echo "=== Rendering $ID → $NAME ==="

  # WebM (VP9) — small size, good for Chrome/Firefox/Edge
  npx remotion render "$ID" "$OUT_DIR/$NAME.webm" --codec vp8

  # MP4 (H.264) — fallback for Safari
  npx remotion render "$ID" "$OUT_DIR/$NAME.mp4" --codec h264

  echo "  ✓ $NAME.webm + $NAME.mp4"
done

echo ""
echo "=== Done ==="
ls -lh "$OUT_DIR"/*.webm "$OUT_DIR"/*.mp4
```

- [ ] **Step 3: Make render script executable**

```bash
chmod +x promo/render-landing.sh
```

- [ ] **Step 4: Commit**

```bash
git add promo/src/Root.tsx promo/render-landing.sh
git commit -m "feat(promo): register landing compositions and add render script"
```

---

### Task 7: Verify in Remotion Studio

- [ ] **Step 1: Run Remotion Studio**

```bash
cd promo && npx remotion studio
```

- [ ] **Step 2: Verify each composition in the browser**

Open `http://localhost:3000` and check each composition under the "Landing" folder:

- **LandingHero** (300 frames): conversation scroll → import notification → logo crystallize → note card slide in → fade out
- **LandingFeatureSearch** (150 frames): search bar typing → shimmer → 3 result cards slide up → fade out
- **LandingFeatureMcp** (150 frames): user message → tool call with spinner → code result → assistant reply → fade out
- **LandingFeatureCli** (180 frames): status → tags → summarize with progress bar → fade out
- **LandingCliShowcase** (360 frames): import with sources → search with results → notes get with full note → fade out

- [ ] **Step 3: Fix any visual issues**

Adjust frame timings if any phase feels too rushed or too slow. The frame numbers in the code are starting points — tune as needed.

- [ ] **Step 4: Commit any fixes**

```bash
git add promo/src/landing/
git commit -m "fix(promo): tune landing animation timings"
```

---

### Task 8: Render and Deploy to site/

- [ ] **Step 1: Render all landing compositions**

```bash
cd promo && bash render-landing.sh
```

Expected: 10 files created in `site/public/demos/` (5 WebM + 5 MP4).

- [ ] **Step 2: Verify file sizes**

```bash
ls -lh site/public/demos/*.webm site/public/demos/*.mp4
```

Each file should be under 5MB. If any are too large, re-render with lower quality or shorter duration.

- [ ] **Step 3: Remove .gitkeep placeholder**

```bash
rm site/public/demos/.gitkeep
```

- [ ] **Step 4: Test in landing page**

```bash
npm run dev:site
```

Open `http://localhost:4321/ChatCrystal/` — verify videos autoplay in Hero, Feature Bento, and CLI Showcase sections.

- [ ] **Step 5: Commit rendered assets**

```bash
git add site/public/demos/
git commit -m "feat(site): add rendered landing page demo videos"
```
