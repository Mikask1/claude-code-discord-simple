export interface UserSession {
  /** SDK session_id from the first SDKSystemMessage. Empty string = no session yet. */
  sessionId: string;
  /** Working directory for this user's Claude Code sessions. */
  cwd: string;
  /** True while a query is currently running for this user. */
  busy: boolean;
  /** AbortController for the current in-progress query, or null if idle. */
  abortController: AbortController | null;
}

// Keyed by Discord channelId — one session per channel/thread
const sessions = new Map<string, UserSession>();

export function getSession(key: string): UserSession | undefined {
  return sessions.get(key);
}

export function getOrCreateSession(key: string, defaultCwd: string): UserSession {
  let session = sessions.get(key);
  if (!session) {
    session = {
      sessionId: '',
      cwd: defaultCwd,
      busy: false,
      abortController: null,
    };
    sessions.set(key, session);
  }
  return session;
}

export function setSessionId(key: string, sessionId: string): void {
  const s = sessions.get(key);
  if (s) s.sessionId = sessionId;
}

export function setBusy(key: string, busy: boolean): void {
  const s = sessions.get(key);
  if (s) s.busy = busy;
}

export function setAbortController(key: string, ac: AbortController | null): void {
  const s = sessions.get(key);
  if (s) s.abortController = ac;
}

/**
 * Interrupts any in-progress query without clearing the session history.
 * Used when a new message arrives while the bot is busy — the next query
 * will resume the same conversation with full context.
 */
export function interruptQuery(key: string): void {
  const s = sessions.get(key);
  if (s) {
    s.abortController?.abort();
    s.busy = false;
    s.abortController = null;
  }
}

/**
 * Fully resets a session: aborts any in-progress query, clears sessionId,
 * and resets busy state. Preserves the cwd preference.
 */
export function resetSession(key: string): void {
  const s = sessions.get(key);
  if (s) {
    s.abortController?.abort();
    s.sessionId = '';
    s.busy = false;
    s.abortController = null;
  }
}

export function setCwd(key: string, cwd: string): void {
  const s = sessions.get(key);
  if (s) s.cwd = cwd;
}
