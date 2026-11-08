import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("前缀命中最优", () => {
    expect(fuzzyMatch("workorder.md", "wor")?.score).toBe(0);
  });
  it("包含命中优于子序列命中", () => {
    const contains = fuzzyMatch("api-workorder.md", "word");
    const subseq = fuzzyMatch("w-o-r-d.md", "word");
    expect(contains).not.toBeNull();
    expect(subseq).not.toBeNull();
    expect(contains!.score).toBeLessThan(subseq!.score);
  });
  it("子序列不匹配返回 null", () => {
    expect(fuzzyMatch("readme.md", "xyz")).toBeNull();
  });
  it("大小写不敏感", () => {
    expect(fuzzyMatch("API变更列表.md", "api")).not.toBeNull();
    expect(fuzzyMatch("api.md", "API")).not.toBeNull();
  });
  it("空 query 匹配一切（score 0）", () => {
    expect(fuzzyMatch("anything", "")?.score).toBe(0);
  });
});
