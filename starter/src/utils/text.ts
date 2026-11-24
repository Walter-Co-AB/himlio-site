const PARAGRAPH_BREAK = /\n\s*\n/;

/** Splits plain text into paragraphs at blank lines, dropping empty ones. */
export function toParagraphs(text: string | null | undefined): string[] {
	return (text ?? "")
		.split(PARAGRAPH_BREAK)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

const WHITESPACE = /\s+/;

/** A name's initials, first and last word: "Anna Maria Berg" → "AB". */
export function initials(name: string): string {
	const letters = name
		.trim()
		.split(WHITESPACE)
		.map((word) => [...word][0] ?? "");
	const ends = letters.length > 1 ? [letters[0], letters.at(-1)] : letters;
	return ends.join("").toUpperCase();
}
