import {describe,it,expect} from "vitest";
async function wrap(runner:any,bind:any){
 const module=await import("./execution.js").catch(()=>null);
 return module?.bindAdmittedCause(runner,bind) ?? runner;
}
describe("selected pass cause publication",()=>{
 it("binds the admitted cycle before Thought receives the unchanged input",async()=>{
  const input={cycle:{cycleId:"actual-admission"},observations:[{id:"original"}]};const order:string[]=[];
  const runner=await wrap((received:unknown)=>{expect(received).toBe(input);order.push("thought");return "ran";},(id:string)=>{order.push(id);});
  expect(await runner(input)).toBe("ran");expect(order).toEqual(["actual-admission","thought"]);
 });
 it("does not run Thought when cause binding rejects the admitted identity",async()=>{
  let calls=0;const runner=await wrap(()=>{calls++;},()=>{throw new Error("identity-rejected");});
  await expect(Promise.resolve().then(()=>runner({cycle:{cycleId:"wrong"}}))).rejects.toThrow("identity-rejected");expect(calls).toBe(0);
 });
});
