// Owner-only attention diagnostics report stored calibration without changing it.
import type {ChatInputCommandInteraction} from "discord.js";
import {getNuclearStatus,type ThalamusStatus} from "../agent-client.js";
import {renderThalamusStatus} from "./thalamus-status.js";
export function renderAttention(status?:ThalamusStatus):string{
 if(!status || status.availability!=="available" || !status.learning)return "Attention calibration: unavailable";
 return `${renderThalamusStatus(status)}\nNucleus gains: ${JSON.stringify(status.learning.gains)}\nFamily gains: ${JSON.stringify(status.learning.familyGains)}\nHabituation: ${JSON.stringify(status.learning.habituation)}`;
}
export async function execute(interaction:ChatInputCommandInteraction):Promise<void>{
 const text=renderAttention((await getNuclearStatus()).thalamus);
 if(text.length<=2000){await interaction.editReply(text);return;}
 await interaction.editReply({content:"Attention calibration attached.",files:[{attachment:Buffer.from(text,"utf8"),name:"attention.txt"}]});
}
