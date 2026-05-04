export class SessionStateManager {
    _config;
    _sessions = new Map();
    constructor(config) {
        this._config = config;
    }
    getOrCreateSession(sessionId) {
        if (!this._sessions.has(sessionId)) {
            this._sessions.set(sessionId, new Set(this._config.anchorTools));
        }
        // Return a copy — callers cannot mutate internal state
        return new Set(this._sessions.get(sessionId));
    }
    getActiveTools(sessionId) {
        const session = this._sessions.get(sessionId);
        if (!session)
            return new Set();
        return new Set(session);
    }
    addTools(sessionId, toolKeys) {
        const session = this._sessions.get(sessionId);
        if (!session)
            return [];
        const newKeys = toolKeys.filter((k) => !session.has(k));
        for (const k of newKeys)
            session.add(k);
        return newKeys;
    }
    promote(sessionId, toolKeys) {
        return this.addTools(sessionId, toolKeys);
    }
    demote(sessionId, toolKeys, usedThisTurn, maxPerTurn = 3) {
        const session = this._sessions.get(sessionId);
        if (!session)
            return [];
        const safeToDemote = toolKeys.filter((k) => session.has(k) && !usedThisTurn.has(k));
        const demoted = safeToDemote.slice(0, maxPerTurn);
        for (const k of demoted)
            session.delete(k);
        return demoted;
    }
    cleanupSession(sessionId) {
        this._sessions.delete(sessionId);
    }
}
//# sourceMappingURL=session.js.map