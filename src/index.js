require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { JsonRpcProvider, Contract, verifyMessage, getAddress, formatUnits } = require("ethers");
const { createStore } = require("./store");
const { createLeaderboardClient, rewardForRank, metric } = require("./leaderboards");

const required = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "PUBLIC_BASE_URL",
  "ROLE_MATT_HOLDER",
  "ROLE_MATT_ELITE",
  "ROLE_MATT_LEGEND"
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.DISCORD_GUILD_ID,
  verifyChannelId: process.env.VERIFY_CHANNEL_ID || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  siteUrl: (process.env.MATT_SITE_URL || "https://matt-token.onrender.com").replace(/\/+$/, ""),
  rpcUrl: process.env.RONIN_RPC_URL || "https://api.roninchain.com/rpc",
  mattContract: process.env.MATT_CONTRACT || "0xa5450417BDCa0BDfB058ffE41205400FfDA1174d",
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "matt-bot-state.json"),
  refreshMs: positiveInteger(process.env.LEADERBOARD_REFRESH_MS, 60_000),
  roleRefreshMs: positiveInteger(process.env.ROLE_REFRESH_MS, 6 * 60 * 60_000),
  challengeTtlMs: positiveInteger(process.env.VERIFY_TOKEN_TTL_MS, 15 * 60_000),
  port: positiveInteger(process.env.PORT, 3000),
  roles: {
    holder: process.env.ROLE_MATT_HOLDER,
    elite: process.env.ROLE_MATT_ELITE,
    legend: process.env.ROLE_MATT_LEGEND
  }
};

const store = createStore(config.dataFile);
const provider = new JsonRpcProvider(config.rpcUrl, 2020, { staticNetwork: true });
const matt = new Contract(config.mattContract, ["function balanceOf(address) view returns (uint256)"], provider);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const leaderboardClient = createLeaderboardClient({ siteUrl: config.siteUrl, store });
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: "1h" }));

app.get("/health", (_req, res) => res.json({
  ok: true,
  discordReady: client.isReady(),
  updatedAt: store.getState().leaderboardCache.updatedAt
}));

app.get("/verify", (req, res) => {
  const challenge = store.challenge(String(req.query.t || ""));
  if (!challenge || challenge.usedAt || challenge.expiresAt <= Date.now()) {
    return res.status(410).send("This verification link expired. Run /verify again in Discord.");
  }
  res.sendFile(path.join(__dirname, "..", "public", "verify.html"));
});

app.get("/api/verify/challenge", (req, res) => {
  const token = String(req.query.t || "");
  const challenge = store.challenge(token);
  if (!challenge || challenge.usedAt || challenge.expiresAt <= Date.now()) {
    return res.status(410).json({ error: "CHALLENGE_EXPIRED" });
  }
  res.json({
    token,
    message: challenge.message,
    expiresAt: challenge.expiresAt
  });
});

app.post("/api/verify/complete", async (req, res) => {
  try {
    const token = String(req.body.token || "");
    const wallet = getAddress(String(req.body.wallet || "")).toLowerCase();
    const signature = String(req.body.signature || "");
    const challenge = store.challenge(token);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= Date.now()) {
      return res.status(410).json({ error: "CHALLENGE_EXPIRED" });
    }
    const recovered = verifyMessage(challenge.message, signature).toLowerCase();
    if (recovered !== wallet) return res.status(401).json({ error: "SIGNATURE_MISMATCH" });

    const existingOwner = store.walletOwner(wallet);
    if (existingOwner && existingOwner !== challenge.discordId) {
      return res.status(409).json({ error: "WALLET_ALREADY_LINKED" });
    }

    store.link(challenge.discordId, wallet);
    store.useChallenge(token);
    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(challenge.discordId);
    const role = await syncRole(member, wallet);
    res.json({ ok: true, wallet, role });
  } catch (error) {
    console.error("Verification failed:", error);
    res.status(400).json({ error: "VERIFY_FAILED", message: safe(error) });
  }
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await leaderboardClient.refresh();
  setInterval(() => leaderboardClient.refresh(), config.refreshMs).unref?.();
  setInterval(refreshAllRoles, config.roleRefreshMs).unref?.();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) return;
  try {
    if (interaction.commandName === "verify") return handleVerify(interaction);
    if (interaction.commandName === "wallet") return handleWallet(interaction);
    if (interaction.commandName === "unlink") return handleUnlink(interaction);
    if (interaction.commandName === "refresh") return handleRefresh(interaction);
    if (interaction.commandName === "stats") return handleStats(interaction);
    if (interaction.commandName === "leaderboard") return handleLeaderboard(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: `Something went wrong: ${safe(error)}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  }
});

async function handleVerify(interaction) {
  if (config.verifyChannelId && interaction.channelId !== config.verifyChannelId) {
    return interaction.reply({
      content: `Use this command in <#${config.verifyChannelId}>.`,
      ephemeral: true
    });
  }
  const token = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = Date.now() + config.challengeTtlMs;
  const message = [
    "MATT Discord Wallet Verification",
    `Discord user: ${interaction.user.id}`,
    `Server: ${config.guildId}`,
    `Nonce: ${nonce}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    "",
    "Signing proves wallet ownership. It does not approve or transfer tokens."
  ].join("\n");
  store.createChallenge(token, {
    discordId: interaction.user.id,
    nonce,
    message,
    expiresAt,
    usedAt: null
  });
  await interaction.reply({
    content: `Verify your wallet here:\n${config.publicBaseUrl}/verify?t=${token}\n\nThis private link expires in 15 minutes.`,
    ephemeral: true
  });
}

async function handleWallet(interaction) {
  const user = store.user(interaction.user.id);
  await interaction.reply({
    content: user ? `Verified wallet: \`${short(user.wallet)}\`` : "You do not have a verified wallet. Run `/verify`.",
    ephemeral: true
  });
}

async function handleUnlink(interaction) {
  store.unlink(interaction.user.id);
  await removeMattRoles(interaction.member);
  await interaction.reply({ content: "Your wallet was unlinked and MATT roles were removed.", ephemeral: true });
}

async function handleRefresh(interaction) {
  const user = store.user(interaction.user.id);
  if (!user) return interaction.reply({ content: "Run `/verify` first.", ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const role = await syncRole(interaction.member, user.wallet);
  await interaction.editReply(`Role refreshed: **${role}**`);
}

async function handleStats(interaction) {
  const user = store.user(interaction.user.id);
  if (!user) return interaction.reply({ content: "Run `/verify` first.", ephemeral: true });
  const cache = store.getState().leaderboardCache;
  const burn = cache.burn.find(row => row.wallet === user.wallet);
  const flip = cache.flip.find(row => row.wallet === user.wallet);
  const blackjack = cache.blackjack.find(row => row.wallet === user.wallet);
  const embed = new EmbedBuilder()
    .setTitle("📊 MATT Player Stats")
    .setDescription(`Wallet: \`${short(user.wallet)}\``)
    .addFields(
      { name: "🔥 Burn", value: burn ? `Rank #${burn.rank}\n${metric(burn, "burn")}` : "No recorded burns", inline: true },
      { name: "🪙 Burn Flip", value: flip ? `Rank #${flip.rank}\n${metric(flip, "flip")}` : "No recorded flips", inline: true },
      { name: "🃏 Blackjack", value: blackjack ? `Rank #${blackjack.rank}\n${metric(blackjack, "blackjack")}` : "No recorded hands", inline: true }
    )
    .setFooter({ text: cache.updatedAt ? `Updated ${new Date(cache.updatedAt).toLocaleString()}` : "Waiting for first update" });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleLeaderboard(interaction) {
  const type = interaction.options.getString("game", true);
  await interaction.deferReply();
  await leaderboardClient.refresh();
  const rows = (store.getState().leaderboardCache[type] || []).slice(0, 10);
  const names = { burn: "🔥 MATT Burn Leaderboard", flip: "🪙 Burn Flip Plays", blackjack: "🃏 Blackjack Plays" };
  const lines = [];
  for (const row of rows) {
    const owner = store.walletOwner(row.wallet);
    const label = owner ? `<@${owner}>` : `\`${short(row.wallet)}\``;
    const reward = type === "burn" && row.rank <= 5 ? ` • 🏆 ${rewardForRank(row.rank).toLocaleString()} MATT` : "";
    lines.push(`**${row.rank}.** ${label} — ${metric(row, type)}${reward}`);
  }
  const embed = new EmbedBuilder()
    .setTitle(names[type])
    .setDescription(lines.length ? lines.join("\n") : "No activity has been indexed yet.")
    .setFooter({ text: type === "burn" ? "Only the Burn leaderboard awards MATT." : "Activity ranking only. No MATT rewards." });
  await interaction.editReply({ embeds: [embed] });
}

async function syncRole(member, wallet) {
  const balance = await matt.balanceOf(wallet);
  const amount = Number(formatUnits(balance, 18));
  let target = null;
  let label = "Future Matt";
  if (amount >= 100_000_000) { target = config.roles.legend; label = "MATT Legend"; }
  else if (amount >= 10_000_000) { target = config.roles.elite; label = "MATT Elite"; }
  else if (amount > 0) { target = config.roles.holder; label = "MATT Holder"; }

  const all = Object.values(config.roles);
  for (const roleId of all) {
    if (roleId !== target && member.roles.cache.has(roleId)) await member.roles.remove(roleId);
  }
  if (target && !member.roles.cache.has(target)) await member.roles.add(target);
  return `${label} (${Math.floor(amount).toLocaleString()} MATT)`;
}

async function removeMattRoles(member) {
  for (const roleId of Object.values(config.roles)) {
    if (member.roles.cache.has(roleId)) await member.roles.remove(roleId);
  }
}

async function refreshAllRoles() {
  const guild = await client.guilds.fetch(config.guildId);
  for (const record of Object.values(store.getState().users)) {
    try {
      const member = await guild.members.fetch(record.discordId);
      await syncRole(member, record.wallet);
    } catch (error) {
      console.warn(`Role refresh failed for ${record.discordId}:`, safe(error));
    }
  }
}

function short(wallet) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}
function safe(error) {
  return String(error?.shortMessage || error?.message || error || "Unknown error").slice(0, 220);
}
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

app.listen(config.port, () => console.log(`Verification server listening on ${config.port}`));
client.login(config.token);
