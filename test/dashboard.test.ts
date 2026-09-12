import { describe, expect, it } from "vitest";
import { renderDashboard } from "../src/dashboard";

describe("dashboard shell", () => {
  it("renders a private, authenticated dashboard shell without fabricated metrics", () => {
    const html = renderDashboard();

    expect(html).toContain("Goldfish · Memory control room");
    expect(html).toContain("Your memory stays private.");
    expect(html).toContain("Dashboard password");
    expect(html).toContain("Memories");
    expect(html).toContain("Agents");
    expect(html).toContain("Memory explorer");
    expect(html).toContain("Relationship graph");
    expect(html).toContain("Goldfish Copilot");
    expect(html).toContain("Settings & taxonomy");
    expect(html).toContain("Optional attachment (up to 5 MB)");
    expect(html).not.toContain("203");
  });

  it("does not serialize supplied aggregate metrics into the unauthenticated document", () => {
    const html = renderDashboard({ memoryRecords: 203, projects: 1, agents: 2, imports: 1 });

    expect(html).not.toContain("203");
    expect(html).toContain("/admin/login");
    expect(html).toContain("/admin/api/projects/");
    expect(html).toContain("graph/rebuild");
    expect(html).toContain("copilot/");
    expect(html).not.toContain("/admin/memories/search");
  });
});
