import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RecipeCatalog,
  canonicalJson,
  createFirstSliceRecipeCatalog,
  hashArgvIdentity,
  hashRecipeDefinition,
  recipeAdmissionError,
  sealRecipe,
  typescriptFixtureCompileV1,
  validateWorkspaceVerifyRequest,
  verifyRecipeIntegrity,
} from "./recipe-catalog.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("M4 recipe catalog", () => {
  it("rejects model command/argv/executable/env/network fields before any lookup", () => {
    const base = {
      version: 2,
      operation: "workspace.verify",
      projectId: "composer-assistant",
      workspaceId: "abcdefgh",
      recipeId: "typescript_fixture_compile_v1",
    };
    expect(validateWorkspaceVerifyRequest({ ...base, command: "tsc" }).ok).toBe(false);
    expect(validateWorkspaceVerifyRequest({ ...base, argv: ["-c", "tsc"] }).ok).toBe(false);
    expect(validateWorkspaceVerifyRequest({ ...base, executable: "/bin/sh" }).ok).toBe(false);
    expect(validateWorkspaceVerifyRequest({ ...base, env: { PATH: "/usr/bin" } }).ok).toBe(false);
    expect(validateWorkspaceVerifyRequest({ ...base, network: "full" }).ok).toBe(false);
    expect(validateWorkspaceVerifyRequest({ ...base, shell: "bash" }).ok).toBe(false);
    const forbidden = validateWorkspaceVerifyRequest({ ...base, command: "tsc" });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error).toBe("request_forbidden_field");
  });

  it("accepts recipeId-only requests", () => {
    const result = validateWorkspaceVerifyRequest({
      version: 2,
      operation: "workspace.verify",
      projectId: "composer-assistant",
      workspaceId: "abcdefgh",
      recipeId: "typescript_fixture_compile_v1",
    });
    expect(result).toEqual({
      ok: true,
      projectId: "composer-assistant",
      workspaceId: "abcdefgh",
      recipeId: "typescript_fixture_compile_v1",
    });
  });

  it("refuses missing workspaceId instead of implying create", () => {
    const result = validateWorkspaceVerifyRequest({
      version: 2,
      operation: "workspace.verify",
      projectId: "composer-assistant",
      recipeId: "typescript_fixture_compile_v1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("workspace_id_invalid");
  });

  it("resolves a catalog hit and misses unknown recipeId", () => {
    const catalog = createFirstSliceRecipeCatalog();
    const hit = catalog.resolve("typescript_fixture_compile_v1");
    expect(hit.ok).toBe(true);
    if (hit.ok) {
      expect(hit.record.networkMode).toBe("none");
      expect(hit.record.definitionHash).toHaveLength(64);
      expect(hit.record.argvIdentity).toHaveLength(64);
    }
    expect(catalog.resolve("not-a-recipe")).toEqual({ ok: false, error: "recipe_not_found" });
  });

  it("treats argv mutation as a new version identity", () => {
    const original = typescriptFixtureCompileV1();
    const mutated = { ...original, argv: [...original.argv, "--strict"] };
    expect(hashRecipeDefinition(original)).not.toBe(hashRecipeDefinition(mutated));
    expect(hashArgvIdentity(original.argv)).not.toBe(hashArgvIdentity(mutated.argv));
  });

  it("detects stored definition-hash tampering before execution", () => {
    const sealed = sealRecipe(typescriptFixtureCompileV1());
    const tampered = { ...sealed, argv: [...sealed.argv, "--extra"] };
    expect(verifyRecipeIntegrity(tampered)).toBe("recipe_integrity_mismatch");
  });

  it("refuses shell and package-manager recipes at catalog admission", () => {
    const base = typescriptFixtureCompileV1();
    expect(recipeAdmissionError({ ...base, executablePath: "/bin/sh" })).toBe("recipe_shell_forbidden");
    expect(recipeAdmissionError({ ...base, argv: ["-c", "tsc"] })).toBe("recipe_shell_forbidden");
    expect(recipeAdmissionError({ ...base, executablePath: "/usr/bin/npm" })).toBe(
      "recipe_package_manager_forbidden",
    );
    expect(
      recipeAdmissionError({
        ...base,
        networkMode: "full" as unknown as "none",
      }),
    ).toBe("recipe_network_forbidden");
    expect(() => new RecipeCatalog([{ ...base, executablePath: "/bin/bash" }])).toThrow(
      /recipe_shell_forbidden/,
    );
  });

  it("loads an operator file catalog analog to project-roots.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-m4-catalog-"));
    tempDirs.push(dir);
    const path = join(dir, "recipes.json");
    writeFileSync(path, JSON.stringify([typescriptFixtureCompileV1()]), "utf8");
    const catalog = RecipeCatalog.loadFromFile(path);
    expect(catalog.resolve("typescript_fixture_compile_v1").ok).toBe(true);
  });

  it("canonicalJson is stable under key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});
