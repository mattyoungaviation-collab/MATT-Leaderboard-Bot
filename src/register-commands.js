require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Connect and verify your Ronin wallet"),
  new SlashCommandBuilder()
    .setName("wallet")
    .setDescription("Show your verified wallet"),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlink your verified wallet"),
  new SlashCommandBuilder()
    .setName("refresh")
    .setDescription("Refresh your MATT holder role"),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show your MATT game statistics"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show a MATT leaderboard")
    .addStringOption(option => option
      .setName("game")
      .setDescription("Leaderboard to show")
      .setRequired(true)
      .addChoices(
        { name: "Burn", value: "burn" },
        { name: "Burn Flip", value: "flip" },
        { name: "Blackjack", value: "blackjack" }
      ))
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
rest.put(
  Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
  { body: commands }
).then(() => {
  console.log(`Registered ${commands.length} commands.`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
