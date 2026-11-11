# Agent logo sources

Logos shown in the home-page marquee (`src/components/AgentLogoMarquee.tsx`).
They are used to identify the AI coding agents ChatCrystal imports; all marks
remain the trademarks of their respective owners and are shown only for
identification (nominative use).

Files live in this folder as `<source-id>.svg` or `<source-id>.png`. The ids
match the conversation-source ids in `server/src/config.ts`.

| Source id | File | Format | Source | Notes |
|---|---|---|---|---|
| `claude-code` | claude-code.svg | SVG | https://claude.com/favicon.svg | Official Claude starburst |
| `claude-desktop` | claude-desktop.svg | SVG | https://claude.com/favicon.svg | Same brand mark |
| `codex` | codex.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/codex-color.svg | Official colored Codex mark curated by lobehub |
| `cursor` | cursor.svg | SVG | https://cursor.com/favicon.svg | Official app icon |
| `copilot` | copilot.svg | SVG | https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/githubcopilot.svg | Official GitHub Copilot mark, recolored #111 |
| `copilot-cli` | copilot-cli.svg | SVG | same as `copilot` | Separated so the CLI can be listed independently |
| `gemini` | gemini.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/gemini-color.svg | Official four-color Gemini star |
| `qwen` | qwen.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/qwen-color.svg | Official Qwen mark (#082DFF) |
| `opencode` | opencode.svg | SVG | https://raw.githubusercontent.com/sst/opencode/dev/packages/ui/src/assets/favicon/favicon.svg | Official app icon |
| `cline` | cline.svg | SVG | https://raw.githubusercontent.com/cline/cline/main/apps/cline-hub/src/webview/public/cline-logo-filled.svg | Official monochrome mark |
| `roo` | roo.svg | SVG | https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/src/assets/icons/icon.svg | Official kangaroo mark |
| `kilo` | kilo.svg | SVG | https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/kilo-console/public/favicon.svg | Official favicon (yellow tile) |
| `continue` | continue.svg | SVG | https://raw.githubusercontent.com/continuedev/continue/main/docs/logo/light.svg | Official hexagon mark |
| `droid` | droid.svg | SVG | https://factory.ai (header inline SVG) | Official Factory mark |
| `goose` | goose.svg | SVG | https://raw.githubusercontent.com/block/goose/main/ui/desktop/src/images/icon.svg (via lobehub) | Official silhouette |
| `antigravity` | antigravity.png | PNG | https://antigravity.google/assets/image/antigravity-logo.png | PNG because the official SVG embeds a raster image |
| `grok` | grok.svg | SVG | @lobehub/icons-static-svg `grok` | xAI slash mark |
| `kimi` | kimi.svg | SVG | @lobehub/icons-static-svg `kimi-color` | Official black K + blue dot |
| `minimax-code` | minimax-code.svg | SVG | @lobehub/icons-static-svg `minimax-color` | Official gradient mark |
| `pi` | pi.svg | SVG | https://pi.dev/logo-auto.svg | Official tri-color Pi mark |
| `omp` | omp.svg | SVG | https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/collab-web/public/favicon.svg | Official favicon |
| `trae` | trae.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/trae-color.svg | Official Trae mark |
| `codebuddy` | codebuddy.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/codebuddy-color.svg | Official CodeBuddy mark |
| `workbuddy` | workbuddy.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/workbuddy-color.svg | Official WorkBuddy mark |
| `qoder` | qoder.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/qoder-color.svg | Qoder mark (chosen over the low-contrast favicon) |
| `qoder-cn` | qoder-cn.svg | SVG | same as `qoder` | Qoder CN shares the Qoder brand |
| `zcode` | zcode.png | PNG | https://raw.githubusercontent.com/zai-org/ZCode/main/public/logo/icons/512x512.png | Official Z.ai ZCode icon (`zcode.ai` is an unrelated site) |
| `dsh` | dsh.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/deepseek-color.svg | Official DeepSeek mark |
| `raft` | raft.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/slock.svg | Slock mark (Raft's former name); monochrome only |
| `cindy` | cindy.png | PNG | https://raw.githubusercontent.com/makecindy/cindy/main/apps/desktop/resources/app-icons/mark-light.png | Official app mark, cropped |
| `hermes` | hermes.svg | SVG | https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.102.0/icons/hermesagent.svg | Official Hermes Agent mark; monochrome only |
| `alma` | alma.png | PNG | https://alma.now/assets/alma.png | Official app icon, cropped |

## Fallbacks

If a file is missing, `src/data/agentLogos.ts` renders a coloured monogram tile
instead (see `monogram()`), so the site keeps working while a logo is being
updated. No monogram is used for the current 32 sources.

## Brand colours

`src/data/agentLogos.ts` carries a `color` per source. It is used for the hover
label and for the monogram fallback. Colours were sampled from the official
marks above.
