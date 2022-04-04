const fs = require('fs');

const file = 'state.json';

module.exports = class DB {
  static getState() {
    try {
      return JSON.parse(fs.readFileSync(file));
    } catch (exc) {
      return {};
    }
  }

  static setState(state) {
    try {
      return fs.writeFileSync(file, JSON.stringify(state, null, 4));
    } catch (exc) {
      return {};
    }
  }

  static getSession(id) {
    const state = this.getState();
    if (!state.sessions) state.sessions = [];
    return state.sessions.find(x => x.id === id);
  }

  static getSessions() {
    const state = this.getState();
    return state.sessions || [];
  }

  static setSession(id, session) {
    const state = this.getState();
    if (!state.sessions) state.sessions = [];
    const index = state.sessions.findIndex(x => x.id === id);
    if (index >= 0) {
      state.sessions[index] = session;
    } else {
      state.sessions.push(session);
    }
    this.setState(state);
  }

  static genSessionId() {
    let id = 1;
    while(true) {
      if (!this.getSession(String(id))) return String(id);
      id++;
    }
  }
}
