# Reddit — r/selfhosted

**Title:** ChatCrystal — self-hosted AI conversation knowledge base (local SQLite, no cloud)

---

**ChatCrystal** is a self-hosted tool that imports your AI coding conversations (Claude Code, Codex CLI, Cursor), summarizes them with an LLM, and lets you search across everything semantically.

**Self-hosted highlights:**

- **Single SQLite file** — powered by sql.js (WASM), no native addon or separate DB process; your data is one portable `.db` file
- **No external services required** — use Ollama for both LLM summarization and embeddings to run fully air-gapped
- **No cloud, no telemetry** — conversations stay on your machine; the tool only makes outbound calls to whatever LLM endpoint you configure
- **Local vector index** — embeddings stored via vectra, a file-based vector index; no Pinecone, no Chroma, no extra service
- **Watcher daemon** — auto-imports new conversations as they appear; run it and forget it

**Requirements:** Node.js 20+

**Quick start:**
```bash
npm install -g chatcrystal
# Configure your LLM in ~/.chatcrystal/config
crystal serve -d        # start background server
crystal import          # import existing conversations
crystal search "query"  # semantic search
```

Also ships as an Electron desktop app (Windows, macOS, Linux).

**Roadmap:** Docker image is planned for those who want proper container deployment.

GitHub: https://github.com/ZengLiangYi/ChatCrystal

Open to contributions and self-hoster feedback — especially around deployment patterns and additional data source adapters.
