// Owner-only attention diagnostics report stored calibration without changing it.
import type {ChatInputCommandInteraction} from "discord.js";
import {getNuclearStatus,type ThalamusStatus} from "../agent-client.js";
import {renderThalamusStatus} from "./thalamus-status.js";
/** One plain line per named value; numbers keep at most three decimals. */
function plainLines(values:Record<string,unknown>):string[] {
 const entries=Object.entries(values);
 if(entries.length===0)return ["- none yet"];
 return entries.map(([name,value])=>`- ${name}: ${typeof value==="number" ? Number(value.toFixed(3)) : String(value)}`);
}
export function renderAttention(status?:ThalamusStatus):string{
 if(!status || status.availability!=="available" || !status.learning)return "Attention calibration: unavailable";
 return [
  renderThalamusStatus(status),
  "",
  "Nucleus sensitivity:",
  ...plainLines(status.learning.gains),
  "Family sensitivity:",
  ...plainLines(status.learning.familyGains),
  "Habituation:",
  ...plainLines(status.learning.habituation),
 ].join("\n");
}
export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
 const text=renderAttention((await getNuclearStatus()).thalamus);
 if(text.length<=2000){await interaction.editReply(text);return;}
 await interaction.editReply({content:"Attention calibration attached.",files:[{attachment:Buffer.from(text,"utf8"),name:"attention.txt"}]});
}
