import { REST, Routes } from "discord.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildCommandDefinitions } from "../src/commands/definitions.js";

const ENV_PATH = join(homedir(), ".composer-assistant", ".env");
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const token = process.env.DISCORD_BOT_TOKEN ?? "";
const guildId = process.env.DISCORD_GUILD_ID ?? "";

if (!token) {
  console.error("DISCORD_BOT_TOKEN missing");
  process.exit(1);
}

const commands = buildCommandDefinitions();

async function main(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const app = (await rest.get(Routes.oauth2CurrentApplication())) as {
    id: string;
  };

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(app.id, guildId), {
      body: commands,
    });
    console.log(`Deployed ${commands.length} guild commands to ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(app.id), { body: commands });
    console.log(`Deployed ${commands.length} global commands`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
