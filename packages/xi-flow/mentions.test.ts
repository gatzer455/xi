import { describe, test, expect } from "bun:test";
import { findMentions, expandMentions, stripFrontmatter, buildSkillBlock } from "./mentions";
import type { SkillRef } from "./mentions";

const SKILLS = new Map<string, SkillRef>([
	["llaneza", { name: "llaneza", path: "/s/llaneza/SKILL.md", baseDir: "/s/llaneza" }],
	["escribir-skill", { name: "escribir-skill", path: "/s/escribir-skill/SKILL.md", baseDir: "/s/escribir-skill" }],
]);

describe("findMentions", () => {
	test("encuentra varias menciones en un mensaje", () => {
		expect(findMentions("¬llaneza y ¬ponytail", "¬")).toEqual([
			{ token: "¬llaneza", name: "llaneza" },
			{ token: "¬ponytail", name: "ponytail" },
		]);
	});

	test("nombres con guion", () => {
		expect(findMentions("¬escribir-skill ahora", "¬")).toEqual([{ token: "¬escribir-skill", name: "escribir-skill" }]);
	});

	test("no matchea mayúsculas ni símbolos sueltos", () => {
		expect(findMentions("¬Llaneza y ¬", "¬")).toEqual([]);
	});

	test("trigger configurable", () => {
		expect(findMentions("el 5% más, %llaneza", "%")).toEqual([{ token: "%llaneza", name: "llaneza" }]);
	});
});

describe("expandMentions", () => {
	const readBody = () => "---\nname: llaneza\n---\n# Llaneza\nEscribir a la llana.";

	test("reemplaza skills conocidos, deja desconocidos como texto", () => {
		const out = expandMentions("¬llaneza revisa esto ¬fantasma", "¬", SKILLS, readBody);
		expect(out).toContain("<skill name=\"llaneza\"");
		expect(out).toContain("References are relative to /s/llaneza");
		expect(out).toContain("Escribir a la llana.");
		expect(out).toContain("¬fantasma");
	});

	test("múltiples skills por mensaje", () => {
		const out = expandMentions("¬llaneza y ¬escribir-skill", "¬", SKILLS, readBody);
		expect(out.match(/<skill name=/g)).toHaveLength(2);
	});

	test("pone los skills fuera del texto del usuario", () => {
		const out = expandMentions("revisá esto con ¬llaneza", "¬", SKILLS, readBody);
		expect(out.startsWith('<skill name="llaneza"')).toBe(true);
		expect(out).toContain("\n\nrevisá esto con ¬llaneza");
		expect(out).not.toContain("con <skill");
	});

	test("conserva la mención inline como referencia", () => {
		const out = expandMentions("usa \"¬llaneza\" y \"¬escribir-skill\"", "¬", SKILLS, readBody);
		expect(out).toContain('usa "¬llaneza" y "¬escribir-skill"');
		expect(out.match(/<skill name=/g)).toHaveLength(2);
	});

	test("sin menciones válidas devuelve el texto intacto", () => {
		const out = expandMentions("hola ¬fantasma", "¬", SKILLS, readBody);
		expect(out).toBe("hola ¬fantasma");
	});
});

describe("stripFrontmatter", () => {
	test("quita el YAML inicial", () => {
		expect(stripFrontmatter("---\nname: x\n---\n# Cuerpo")).toBe("# Cuerpo");
	});

	test("sin frontmatter devuelve el contenido", () => {
		expect(stripFrontmatter("# Cuerpo")).toBe("# Cuerpo");
	});
});

describe("buildSkillBlock", () => {
	test("formato idéntico al nativo de pi", () => {
		const block = buildSkillBlock("llaneza", SKILLS.get("llaneza")!, "---\nname: llaneza\n---\n# Cuerpo");
		expect(block).toBe(
			'<skill name="llaneza" location="/s/llaneza/SKILL.md">\nReferences are relative to /s/llaneza.\n\n# Cuerpo\n</skill>',
		);
	});
});
