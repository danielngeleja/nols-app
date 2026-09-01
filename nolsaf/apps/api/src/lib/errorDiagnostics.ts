import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { SourceMap } from "module";
import { fileURLToPath } from "url";
import { loadPrivateSourceMap, type PrivateSourceMapPayload } from "./privateSourceMaps.js";
import { getReleaseMetadata } from "./releaseMetadata.js";

export type DiagnosticCodeLine = {
  line: number;
  content: string;
  highlight: boolean;
};

export type DiagnosticFrame = {
  functionName: string | null;
  file: string;
  line: number | null;
  column: number | null;
  inApp: boolean;
  mapped: boolean;
  codeContext?: DiagnosticCodeLine[];
  sourceLink?: string | null;
};

export type ErrorDiagnostic = {
  service: "web" | "api";
  release: string | null;
  fingerprint: string;
  primaryFrame: DiagnosticFrame | null;
  frames: DiagnosticFrame[];
};

type DiagnosticInput = {
  service: "web" | "api";
  message?: unknown;
  stack?: unknown;
  source?: unknown;
  line?: unknown;
  column?: unknown;
  release?: unknown;
};

export async function buildErrorDiagnostic(input: DiagnosticInput): Promise<ErrorDiagnostic> {
  const release = cleanText(input.release, 160) ?? getReleaseMetadata().revision;
  const stack = cleanText(input.stack, 12_000);
  const source = cleanSource(input.source);
  const fallbackLine = positiveInteger(input.line);
  const fallbackColumn = positiveInteger(input.column);
  const parsed = parseStack(stack);

  if (parsed.length === 0 && source) {
    parsed.push({
      functionName: null,
      file: source,
      line: fallbackLine,
      column: fallbackColumn,
      inApp: isInAppSource(source),
      mapped: isOriginalSourceFile(source),
    });
  }

  const frames: DiagnosticFrame[] = [];
  for (const frame of parsed.slice(0, 16)) {
    frames.push(await mapFrame(frame, release, input.service));
  }

  const primaryFrame = frames.find((frame) => frame.inApp) ?? frames[0] ?? null;
  const fingerprintInput = [
    input.service,
    cleanText(input.message, 500) ?? "Unknown error",
    primaryFrame?.file ?? source ?? "unknown",
    primaryFrame?.line ?? fallbackLine ?? 0,
  ].join("|");

  return {
    service: input.service,
    release,
    fingerprint: crypto.createHash("sha256").update(fingerprintInput).digest("hex").slice(0, 20),
    primaryFrame,
    frames,
  };
}

function parseStack(stack: string | null): DiagnosticFrame[] {
  if (!stack) return [];
  const frames: DiagnosticFrame[] = [];

  for (const rawLine of stack.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const chrome = line.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    const firefox = line.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    const match = chrome || firefox;
    if (!match) continue;

    const file = cleanSource(match[2]);
    if (!file) continue;
    frames.push({
      functionName: cleanText(match[1], 240),
      file,
      line: positiveInteger(match[3]),
      column: positiveInteger(match[4]),
      inApp: isInAppSource(file),
      mapped: isOriginalSourceFile(file),
    });
  }

  return frames;
}

async function mapFrame(
  frame: DiagnosticFrame,
  release: string | null,
  service: "web" | "api",
): Promise<DiagnosticFrame> {
  if (frame.mapped) {
    return { ...frame, sourceLink: buildSourceLink(frame.file, frame.line, release, service) };
  }
  if (!frame.line || !frame.column) return frame;

  const sourceMapDirs = getSourceMapDirs();
  if (sourceMapDirs.length === 0) return frame;

  let mapFile: string | null = await findAdjacentSourceMap(frame.file);
  for (const sourceMapDir of sourceMapDirs) {
    if (mapFile) break;
    mapFile = await findSourceMapFile(sourceMapDir, frame.file, release);
  }
  try {
    let payload: PrivateSourceMapPayload | null = null;
    if (mapFile) {
      const raw = await fs.readFile(mapFile, "utf8");
      if (raw.length > 25_000_000) return frame;
      payload = JSON.parse(raw) as PrivateSourceMapPayload;
    } else {
      payload = await loadPrivateSourceMap(frame.file, release);
    }
    if (!payload) return frame;
    const sourceMap = new SourceMap(payload as any);
    const entry = sourceMap.findEntry(
      Math.max(0, frame.line - 1),
      Math.max(0, frame.column - 1)
    ) as {
      originalSource?: string;
      originalLine?: number;
      originalColumn?: number;
      name?: string;
    };
    if (!entry?.originalSource || entry.originalLine == null) return frame;

    const originalFile = normalizeOriginalSource(String(entry.originalSource));
    const originalLine = Number(entry.originalLine) + 1;
    const originalColumn = entry.originalColumn == null ? null : Number(entry.originalColumn) + 1;
    const sourceIndex = payload.sources?.findIndex((item) => item === entry.originalSource) ?? -1;
    const sourceContent = sourceIndex >= 0 ? payload.sourcesContent?.[sourceIndex] ?? null : null;

    return {
      functionName: entry.name ? String(entry.name) : frame.functionName,
      file: originalFile,
      line: originalLine,
      column: originalColumn,
      inApp: true,
      mapped: true,
      codeContext: sourceContent ? getCodeContext(sourceContent, originalLine) : undefined,
      sourceLink: buildSourceLink(originalFile, originalLine, release, service),
    };
  } catch {
    return frame;
  }
}

async function findAdjacentSourceMap(source: string): Promise<string | null> {
  let localPath: string | null = null;
  try {
    if (source.startsWith("file://")) localPath = fileURLToPath(source);
    else if (path.isAbsolute(source)) localPath = source;
  } catch {
    localPath = null;
  }
  if (!localPath) return null;

  try {
    const candidate = `${localPath}.map`;
    const stat = await fs.stat(candidate);
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function getSourceMapDirs() {
  const configured = cleanText(process.env.SOURCE_MAP_DIR, 1_000);
  const candidates = [
    configured,
    path.resolve(process.cwd(), "artifacts", "source-maps"),
    path.resolve(process.cwd(), "..", "..", "artifacts", "source-maps"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return Array.from(new Set(candidates));
}

async function findSourceMapFile(root: string, source: string, release: string | null): Promise<string | null> {
  const rootPath = path.resolve(root);
  const sourcePath = sourcePathname(source).replace(/^\/+/, "");
  if (!sourcePath) return null;

  const relativeMap = `${sourcePath}.map`;
  const candidates = [
    release ? path.resolve(rootPath, release, relativeMap) : null,
    path.resolve(rootPath, relativeMap),
    path.resolve(rootPath, `${path.basename(sourcePath)}.map`),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!candidate.startsWith(`${rootPath}${path.sep}`)) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next private source-map location.
    }
  }
  return null;
}

function getCodeContext(source: string, targetLine: number): DiagnosticCodeLine[] {
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, targetLine - 3);
  const end = Math.min(lines.length, targetLine + 3);
  const context: DiagnosticCodeLine[] = [];
  for (let line = start; line <= end; line += 1) {
    context.push({ line, content: lines[line - 1] ?? "", highlight: line === targetLine });
  }
  return context;
}

function buildSourceLink(
  file: string,
  line: number | null,
  release: string | null,
  service: "web" | "api",
) {
  const metadata = getReleaseMetadata();
  const repository = cleanText(metadata.repository, 500);
  if (!repository || !isOriginalSourceFile(file)) return null;
  const base = repository.replace(/\/$/, "");
  const revision = encodeURIComponent(release || metadata.revision || process.env.SOURCE_REVISION || "main");
  const cleanFile = repositoryFilePath(file, service, metadata.projectPath);
  return `${base}/blob/${revision}/${cleanFile}${line ? `#L${line}` : ""}`;
}

function repositoryFilePath(file: string, service: "web" | "api", projectPath: string | null) {
  const clean = file.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
  if (projectPath && (clean === projectPath || clean.startsWith(`${projectPath}/`))) return clean;
  const projectRelative = /^(?:apps|packages|prisma|scripts)\//.test(clean)
    ? clean
    : `apps/${service}/${clean}`;
  return projectPath ? `${projectPath}/${projectRelative}` : projectRelative;
}

function cleanSource(value: unknown) {
  const text = cleanText(value, 1_500);
  if (!text) return null;
  return text.replace(/[?#].*$/, "").replace(/^webpack-internal:\/\/\/(?:\.\/)?/, "");
}

function normalizeOriginalSource(value: string) {
  return value
    .replace(/^webpack:\/\/(?:_N_E\/)?/, "")
    .replace(/^webpack-internal:\/\/\/(?:\.\/)?/, "")
    .replace(/^\.\//, "")
    .replace(/^(?:\.\.\/)+/, "")
    .replace(/^\/+/, "");
}

function sourcePathname(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return value.replace(/^webpack:\/\//, "");
  }
}

function isOriginalSourceFile(file: string) {
  return /\.(?:tsx?|jsx)$/.test(file) && !file.includes("/_next/static/");
}

function isInAppSource(file: string) {
  return !/(?:node_modules|next\/dist|react-dom|webpack\/runtime|<anonymous>)/i.test(file);
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
