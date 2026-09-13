import { describe, it, expect } from "vitest";
import { classifyAgentStartupError } from "./classify.js";
import { EXIT_CODES } from "./exit-codes.js";

describe("classifyAgentStartupError", () => {
  it("classifies unsupported_nuclear_schema as OPERATOR_REQUIRED", () => {
    const err = new Error("unsupported_nuclear_schema:31>30") as Error & { code?: string };
    err.code = "unsupported_nuclear_schema";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
    expect(res.code).toBe("unsupported_nuclear_schema");
  });

  it("classifies nuclear_migration_authority_required as OPERATOR_REQUIRED", () => {
    const err = new Error("nuclear_migration_authority_required") as Error & { code?: string };
    err.code = "nuclear_migration_authority_required";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies data_plane_required as OPERATOR_REQUIRED", () => {
    const err = new Error("data_plane_required") as Error & { code?: string };
    err.code = "data_plane_required";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies production_data_plane_required as OPERATOR_REQUIRED", () => {
    const err = new Error("production_data_plane_required") as Error & { code?: string };
    err.code = "production_data_plane_required";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies continuity_lineage_missing as OPERATOR_REQUIRED", () => {
    const err = new Error("continuity_lineage_missing") as Error & { code?: string };
    err.code = "continuity_lineage_missing";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies continuity_lineage_mismatch as OPERATOR_REQUIRED", () => {
    const err = new Error("continuity_lineage_mismatch") as Error & { code?: string };
    err.code = "continuity_lineage_mismatch";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies boot_validation_failed as OPERATOR_REQUIRED", () => {
    const err = new Error("Boot configuration invalid") as Error & { code?: string };
    err.code = "boot_validation_failed";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("OPERATOR_REQUIRED");
    expect(res.exitCode).toBe(EXIT_CODES.OPERATOR_REQUIRED);
  });

  it("classifies SQLITE_BUSY as RETRYABLE", () => {
    const err = new Error("database is locked") as Error & { code?: string };
    err.code = "SQLITE_BUSY";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("RETRYABLE");
    expect(res.exitCode).toBe(EXIT_CODES.TRANSIENT);
    expect(res.code).toBe("SQLITE_BUSY");
  });

  it("classifies EADDRINUSE as RETRYABLE", () => {
    const err = new Error("port in use") as Error & { code?: string };
    err.code = "EADDRINUSE";
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("RETRYABLE");
    expect(res.exitCode).toBe(EXIT_CODES.TRANSIENT);
  });

  it("defaults unclassified or unknown errors to RETRYABLE", () => {
    const err = new Error("Something went wrong");
    const res = classifyAgentStartupError(err);
    expect(res.kind).toBe("RETRYABLE");
    expect(res.exitCode).toBe(EXIT_CODES.TRANSIENT);
    expect(res.code).toBe("UNRECOGNIZED_STARTUP_ERROR");
  });
});
