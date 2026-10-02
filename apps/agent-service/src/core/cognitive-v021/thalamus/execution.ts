import type {IdleThoughtRunner} from "../initiative/idle.js";
export type SelectedPassExecution = {timing:"thalamus";bind:(cycleId:string)=>void};
/** The executor retains admission and budget ownership; only an actual admission binds a proposal. */
export function bindAdmittedCause(runner:IdleThoughtRunner,bind:(cycleId:string)=>void):IdleThoughtRunner {
 return input=>{bind(input.cycle.cycleId);return runner(input);};
}
