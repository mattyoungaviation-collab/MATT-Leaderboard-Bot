const REWARDS = [1_000_000, 800_000, 600_000, 500_000, 200_000];

function createLeaderboardClient({ siteUrl, store }) {
  const base = String(siteUrl || "").replace(/\/+$/, "");

  async function getJson(pathname) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${base}${pathname}`, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refresh() {
    const previous = store.getState().leaderboardCache;
    const next = {};

    try {
      const payload = await getJson("/api/burn/leaderboard?limit=100");
      next.burn = normalize(payload.players || payload.rows || [], "burn");
    } catch (error) {
      console.warn("Burn leaderboard refresh failed:", String(error.message || error));
      next.burn = previous.burn || [];
    }

    try {
      const payload = await getJson("/api/burnflip/leaderboard?sort=flips-desc&limit=100");
      next.flip = normalize(payload.players || [], "flip");
    } catch (error) {
      console.warn("Flip leaderboard refresh failed:", String(error.message || error));
      next.flip = previous.flip || [];
    }

    try {
      const payload = await getJson("/api/blackjack/leaderboard?sort=hands-desc&limit=100");
      next.blackjack = normalize(payload.players || payload.rows || [], "blackjack");
    } catch (error) {
      console.warn("Blackjack leaderboard refresh failed:", String(error.message || error));
      next.blackjack = previous.blackjack || [];
    }

    store.setLeaderboards(next);
    return store.getState().leaderboardCache;
  }

  function normalize(rows, type) {
    return rows.map((row, index) => ({
      rank: Number(row.rank || index + 1),
      wallet: String(row.wallet || "").toLowerCase(),
      burns: Number(row.burns || row.burnCount || 0),
      burnedRaw: String(row.burnedRaw || row.totalBurnedRaw || "0"),
      flips: Number(row.flips || 0),
      hands: Number(row.hands || row.handsPlayed || 0),
      wins: Number(row.wins || 0),
      type
    })).filter(row => /^0x[0-9a-f]{40}$/.test(row.wallet));
  }

  return { refresh };
}

function rewardForRank(rank) {
  return REWARDS[rank - 1] || 0;
}

function metric(row, type) {
  if (type === "burn") return `${formatMatt(row.burnedRaw)} MATT burned`;
  if (type === "flip") return `${Number(row.flips || 0).toLocaleString()} flips`;
  return `${Number(row.hands || 0).toLocaleString()} hands`;
}

function formatMatt(raw) {
  try {
    const value = BigInt(raw || "0");
    const whole = value / 10n ** 18n;
    return whole.toLocaleString("en-US");
  } catch {
    return "0";
  }
}

module.exports = { createLeaderboardClient, rewardForRank, metric, formatMatt };
