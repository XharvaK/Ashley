import {THALAMUS_PARAMETERS as P} from "./parameters.js";
/** Release defaults to the old paths until the Owner enables the new scheduler. */
export function isThalamusEnabled():boolean {
 return process.env.ASHLEY_THALAMUS_ENABLED?.trim().toLowerCase()==="true";
}
export function schedulerContract(){
 return {owner:isThalamusEnabled()?"thalamus":"bot",contractVersion:P.schedulerContractVersion.default} as const;
}
let gatewayUserId:string|null=null;
/** A transport-authenticated gateway observation; never a social grant or ownership selector. */
export function observeGatewayUserId(value:unknown):boolean {
 if(typeof value!=="string" || !/^[1-9][0-9]{15,19}$/.test(value))return false;
 gatewayUserId=value;return true;
}
export function currentGatewayUserId():string|null{return gatewayUserId;}
