import { describe, expect, it } from "vitest";
import { deriveDraftTitle, draftFileName } from "../draftTitle";

describe("deriveDraftTitle（草稿标题从首行抽取）", () => {
  it("ATX 标题剥掉 # 标记", () => {
    expect(deriveDraftTitle("# 会议纪要\n\n正文", "未命名.md")).toBe("会议纪要");
    expect(deriveDraftTitle("###带空格的标题", "未命名.md")).toBe("带空格的标题");
  });

  it("列表 / 任务 / 有序列表 / 引用剥掉标记", () => {
    expect(deriveDraftTitle("- [x] 完成购物清单", "未命名.md")).toBe("完成购物清单");
    expect(deriveDraftTitle("- 待办事项", "未命名.md")).toBe("待办事项");
    expect(deriveDraftTitle("1. 第一点", "未命名.md")).toBe("第一点");
    expect(deriveDraftTitle("> 引用内容", "未命名.md")).toBe("引用内容");
  });

  it("首行为分隔线/围栏/空行时跳到下一有效行", () => {
    expect(deriveDraftTitle("---\n\n真实标题", "未命名.md")).toBe("真实标题");
    expect(deriveDraftTitle("```js\nconst a = 1;", "未命名.md")).toBe("const a = 1;");
    expect(deriveDraftTitle("\n\n  缩进行也有效 ", "未命名.md")).toBe("缩进行也有效");
  });

  it("超长截断到 24 字符加省略号", () => {
    const long = "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳";
    expect(deriveDraftTitle(long, "未命名.md")).toBe("一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯…");
  });

  it("空内容 / 全空白回退到当前标题", () => {
    expect(deriveDraftTitle("", "未命名.md")).toBe("未命名.md");
    expect(deriveDraftTitle("   \n  \n", "未命名 2.md")).toBe("未命名 2.md");
    expect(deriveDraftTitle("#\n---\n***", "未命名.md")).toBe("未命名.md");
  });
});

describe("draftFileName（保存面板默认名）", () => {
  it("补扩展名", () => {
    expect(draftFileName("会议纪要", "md")).toBe("会议纪要.md");
    expect(draftFileName("查询脚本", "sql")).toBe("查询脚本.sql");
    expect(draftFileName("notes", "txt")).toBe("notes.txt");
  });

  it("已带扩展名不重复补", () => {
    expect(draftFileName("未命名.md", "md")).toBe("未命名.md");
  });

  it("清洗文件名非法字符", () => {
    expect(draftFileName("a/b:c", "md")).toBe("a-b-c.md");
    expect(draftFileName("  多  空格  ", "md")).toBe("多 空格.md");
  });

  it("全非法字符时回退不产生空名", () => {
    expect(draftFileName("//:", "md")).toBe("---.md");
  });
});
