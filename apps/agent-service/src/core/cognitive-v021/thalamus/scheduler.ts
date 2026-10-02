import {THALAMUS_PARAMETERS as P} from "./parameters.js";
/** Release defaults to the old paths until the Owner enables the new scheduler. */
export function isThalamusEnabled():boolean {
 return process.env.ASHLEY_THALAMUS_ENABLED?.trim().toLowerCase()==="true";
}
export function schedulerContract(){
 return {owner:isThalamusEnabled()?"thalamus":"bot",contractVersion:P.schedulerContractVersion.default} as const;
}
