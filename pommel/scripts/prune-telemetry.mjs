#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function printUsage() {
  console.log('Usage: node scripts/prune-telemetry.mjs [jsonlPath] [--dry-run]');
  console.log('Default jsonlPath: logs/telemetry.jsonl');
}

function parseArgs(argv) {
  let logPath = 'logs/telemetry.jsonl';
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    logPath = arg;
  }

  return { logPath, dryRun };
}

function loadEvents(filePath) {
  const input = fs.readFileSync(filePath, 'utf8');
  const lines = input.split('\n').filter(Boolean);
  const events = [];
  let invalidJsonLines = 0;

  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      invalidJsonLines += 1;
    }
  }

  return { lines, events, invalidJsonLines };
}

function computeSessionStats(events) {
  const bySession = new Map();

  for (const event of events) {
    const sessionId = event?.sessionId || '__no_session__';
    let stat = bySession.get(sessionId);

    if (!stat) {
      stat = {
        sessionId,
        totalEvents: 0,
        gamepadConnected: false,
        gamepadFrames: 0,
        robotConnected: false,
      };
      bySession.set(sessionId, stat);
    }

    stat.totalEvents += 1;

    if (event?.category === 'gamepad' && (event?.type === 'connected' || event?.type === 'frame')) {
      stat.gamepadConnected = true;
    }

    if (event?.category === 'gamepad' && event?.type === 'frame') {
      stat.gamepadFrames += 1;
    }

    if (event?.category === 'serial' && event?.type === 'port_opened') {
      stat.robotConnected = true;
    }
  }

  return bySession;
}

function main() {
  const { logPath, dryRun } = parseArgs(process.argv.slice(2));
  const absPath = path.resolve(logPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Telemetry file not found: ${absPath}`);
  }

  const { lines, events, invalidJsonLines } = loadEvents(absPath);
  const bySession = computeSessionStats(events);

  const keepSessions = new Set();
  let totalGamepadFrames = 0;

  for (const stat of bySession.values()) {
    totalGamepadFrames += stat.gamepadFrames;
    if (stat.gamepadConnected && stat.robotConnected) {
      keepSessions.add(stat.sessionId);
    }
  }

  const keptEvents = events.filter((event) => {
    const sessionId = event?.sessionId || '__no_session__';
    return keepSessions.has(sessionId);
  });

  const summary = {
    file: absPath,
    dryRun,
    originalLineCount: lines.length,
    parsedEventCount: events.length,
    invalidJsonLines,
    originalSessionCount: bySession.size,
    keptSessionCount: keepSessions.size,
    droppedSessionCount: bySession.size - keepSessions.size,
    keptEventCount: keptEvents.length,
    droppedEventCount: events.length - keptEvents.length,
    totalGamepadFrameEvents: totalGamepadFrames,
  };

  if (!dryRun) {
    const backupPath = `${absPath}.bak`;
    fs.copyFileSync(absPath, backupPath);

    const output = keptEvents.map((event) => JSON.stringify(event)).join('\n');
    fs.writeFileSync(absPath, output + (output ? '\n' : ''), 'utf8');

    summary.backup = backupPath;
  }

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
}
