import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { handleSlash } from "./interactionCreate.js";

function expiredInteraction(userId: string, commandName: string) {
  return {
    user: { id: userId },
    commandName,
    deferred: false,
    replied: false,
    options: { getString: () => null },
    deferReply: async () => {
      throw new Error("Unknown interaction");
    },
    reply: async () => {
      throw new Error("Unknown interaction");
    },
    editReply: async () => {
      throw new Error("Unknown interaction");
    },
  } as never;
}

test("an expired slash interaction does not reject the handler (A6-10)", async () => {
  await assert.doesNotReject(handleSlash(expiredInteraction(config.ownerId, "status")));
});

test("a refused non-Owner slash interaction that has expired does not reject either (A6-10)", async () => {
  await assert.doesNotReject(handleSlash(expiredInteraction("someone-else", "status")));
});
