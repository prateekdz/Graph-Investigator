# O2C Graph Investigator

Graph-first exploration and dataset-grounded chat for SAP-style **Order-to-Cash (O2C)** data.

This project supports a production-oriented analyst workflow:

- Explore a relationship-heavy dataset as an interactive graph.
- Ask questions that translate into **read-only queries** under strict policy controls.
- Highlight referenced entities to keep investigations focused and navigable.

## Product surfaces

- **Graph canvas:** pan/zoom, selection focus, neighborhood highlighting.
- **Chat sidebar:** structured answers, optional executed-query disclosure, actionable suggestions.
- **Floating record card:** compact, field/value layout for the selected entity.

## Screenshots

Place screenshots in `screenshots/`:

- `screenshots/dashboard.png` — Full dashboard: graph + chat + floating record card.
- `screenshots/graph.png` — Investigation focus: selection + floating record details.
- `screenshots/chat.png` — Structured answer with evidence blocks and “Open” pivots.

![Dashboard](screenshots/dashboard.png)

![Graph + Detail Card](screenshots/graph.png)

![Chat + Evidence](screenshots/chat.png)

## Architecture

### Frontend (React)

- Vite + Tailwind CSS
- `react-force-graph-2d` for the graph visualization
- Chat and record surfaces designed for fast investigation pivots

### Backend (Node/Express)

- REST API:
  - `GET /health`
  - `GET /api/graph`
  - `GET /api/node/:id`
  - `GET /api/search?q=...`
  - `POST /api/ask`
- Storage modes:
  - **Neo4j** (primary, for traversals)
  - **File dataset fallback** (deterministic local/prod runs without Neo4j)

### Graph model (O2C)

Primary entity types:

- `Customer`, `Order`, `Delivery`, `Invoice`, `Payment`, `JournalEntry`

Typical flow:

`Customer → Order → Delivery → Invoice → Payment → JournalEntry`

## Data flow (chat lifecycle)

1. User asks a question in chat.
2. Backend attempts **NL → query plan** (LLM, optional).
3. Policy enforcement:
   - read-only validation
   - dataset-only schema allowlists
   - LIMIT clamp + timeout
4. Execution:
   - Neo4j (Cypher) or file-backed fallback when Neo4j is unavailable
5. Response:
   - structured answer
   - highlights for graph focus
   - optional executed-query block

## Repository layout

```
backend/
  src/                 # Express app (Neo4j + fallback APIs)
  services/            # file-backed graph store and parsing
  scripts/             # importer utilities

frontend/
  src/components/      # dashboard UI building blocks
  src/pages/           # page composition + data wiring
  src/api/             # API base config

data/                  # SAP O2C dataset
screenshots/           # screenshots referenced in this README
```

## Local development

Prerequisites:

- Node.js 18+
- (Optional) Neo4j running with Bolt enabled

### Backend

```
cd backend
npm install
npm start
```

Health check:

```
http://localhost:4000/health
```

Neo4j is optional. For file-only mode, set:

- `NEO4J_DISABLED=1`

### Frontend

```
cd frontend
npm install
npm run dev
```

Configure the backend URL (optional):

- `frontend/.env` → `VITE_API_BASE_URL=http://localhost:4000`

## Deployment (Vercel + Render)

### Frontend → Vercel

1. Import this repo in Vercel.
2. Set **Root Directory** to `frontend/`.
3. Build settings:
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Environment variables:
   - `VITE_API_BASE_URL=https://<your-backend>.onrender.com`

### Backend → Render

1. Create a **Web Service** in Render.
2. Set **Root Directory** to `backend/`.
3. Build Command: `npm ci`
4. Start Command: `npm start`
5. Environment variables (minimum):
   - `NEO4J_DISABLED=1` (recommended unless you provision Neo4j)
   - `DATA_DIR=../data/sap-order-to-cash/sap-o2c-data`
   - `CORS_ORIGIN=https://<your-frontend>.vercel.app`
6. (Optional LLM):
   - `LLM_PROVIDER=gemini` + `GEMINI_API_KEY=...`
   - or `LLM_PROVIDER=groq` + `GROQ_API_KEY=...`

Render provides `PORT` automatically; the backend binds to `process.env.PORT`.

## Environment variables

Use the provided examples:

- `backend/.env.example`
- `frontend/.env.example`

Do not commit secrets (API keys, DB passwords). Use Vercel/Render environment settings.

## Operational notes

- If Neo4j is down/unreachable, the app continues to function using the file dataset fallback.
- `POST /api/ask` never “hallucinates” dataset facts: it either executes a read-only query or falls back to deterministic dataset lookup.

## License

MIT
