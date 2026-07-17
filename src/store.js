const fs = require("fs");
const path = require("path");

function createStore(filename) {
  const file = path.resolve(filename);
  let state = load(file);

  function load(target) {
    try {
      if (!fs.existsSync(target)) return fresh();
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      return parsed && parsed.version === 1 ? parsed : fresh();
    } catch (error) {
      console.warn("Could not load state:", String(error.message || error));
      return fresh();
    }
  }

  function fresh() {
    return {
      version: 1,
      users: {},
      walletOwners: {},
      challenges: {},
      leaderboardCache: {
        burn: [],
        flip: [],
        blackjack: [],
        updatedAt: null
      }
    };
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, file);
  }

  function cleanupChallenges() {
    const now = Date.now();
    for (const [token, challenge] of Object.entries(state.challenges)) {
      if (!challenge || challenge.expiresAt <= now || challenge.usedAt) {
        delete state.challenges[token];
      }
    }
  }

  return {
    getState: () => state,
    save,
    cleanupChallenges,
    user(discordId) {
      return state.users[String(discordId)] || null;
    },
    walletOwner(wallet) {
      return state.walletOwners[String(wallet).toLowerCase()] || null;
    },
    link(discordId, wallet) {
      discordId = String(discordId);
      wallet = String(wallet).toLowerCase();
      const old = state.users[discordId]?.wallet;
      if (old && old !== wallet) delete state.walletOwners[old];
      state.users[discordId] = {
        ...(state.users[discordId] || {}),
        discordId,
        wallet,
        verifiedAt: new Date().toISOString()
      };
      state.walletOwners[wallet] = discordId;
      save();
      return state.users[discordId];
    },
    unlink(discordId) {
      discordId = String(discordId);
      const old = state.users[discordId]?.wallet;
      if (old) delete state.walletOwners[old];
      delete state.users[discordId];
      save();
    },
    createChallenge(token, record) {
      cleanupChallenges();
      state.challenges[token] = record;
      save();
    },
    challenge(token) {
      cleanupChallenges();
      return state.challenges[token] || null;
    },
    useChallenge(token) {
      if (state.challenges[token]) {
        state.challenges[token].usedAt = Date.now();
        save();
      }
    },
    setLeaderboards(next) {
      state.leaderboardCache = {
        ...state.leaderboardCache,
        ...next,
        updatedAt: new Date().toISOString()
      };
      save();
    }
  };
}

module.exports = { createStore };
