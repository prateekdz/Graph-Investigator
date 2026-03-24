const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const SUPPORTED_EXT = new Set([".jsonl", ".json", ".csv"]);

async function* readJsonLines(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed);
  }
}

function parseCsvLine(line) {
  // Minimal CSV parser sufficient for simple, unquoted datasets.
  // If your CSV contains quoted commas/newlines, switch to papaparse/csv-parse.
  return line.split(",").map((s) => s.trim());
}

async function readCsv(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  let headers = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }
    const values = parseCsvLine(line);
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) obj[headers[i]] = values[i] ?? "";
    rows.push(obj);
  }
  return rows;
}

async function readJson(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function readJsonl(filePath) {
  const rows = [];
  for await (const r of readJsonLines(filePath)) rows.push(r);
  return rows;
}

async function listFilesRecursive(dirPath) {
  const out = [];
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dirPath, e.name);
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function inferEntityKeyFromPath(filePath, baseDir) {
  const rel = path.relative(baseDir, filePath);
  const parts = rel.split(path.sep);
  // Prefer directory name (matches this dataset layout).
  return parts.length > 1 ? parts[0] : path.basename(filePath, path.extname(filePath));
}

async function loadDatasetFiles(baseDir) {
  const files = await listFilesRecursive(baseDir);
  const byEntityKey = new Map();

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXT.has(ext)) continue;

    const key = inferEntityKeyFromPath(filePath, baseDir);
    let rows;
    if (ext === ".jsonl") rows = await readJsonl(filePath);
    else if (ext === ".json") rows = await readJson(filePath);
    else if (ext === ".csv") rows = await readCsv(filePath);
    else continue;

    if (!byEntityKey.has(key)) byEntityKey.set(key, []);
    byEntityKey.get(key).push(...rows);
  }

  return byEntityKey;
}

module.exports = { loadDatasetFiles };

