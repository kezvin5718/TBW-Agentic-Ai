/**
 * What a designer's filename says about where a creative sits in the month.
 *
 * The studio numbers its posts and letters the slides of a carousel:
 *
 *   Post 1A, Post 1B, Post 1C   → post 1, a carousel, slides A–C
 *   Post 3                      → post 3, a single post
 *   Reel 4                      → post 4
 *
 * and writes it a dozen ways — "Post 1A", "Post 1 A", "Post 1_A", "Post 1-A",
 * "Post1a", "1A", "1_A", "1-A". Every one of those reads the same here. Pure
 * functions, no I/O: the uploader in the browser and the server both use them,
 * so the screen and the database can never disagree about what a name means.
 *
 * Deliberately narrow. A number is a post number only when it is 1–3 digits,
 * not part of a longer number (IMG_4521, 1080x1350), and the last thing in the
 * name apart from an optional slide letter. "Diwali Offer 25% OFF" has no post
 * number; nothing is guessed.
 */

export interface PostName {
  /** The post's number in the month, or null when the name does not carry one. */
  postNumber: number | null;
  /** The carousel slide letter, lowercase ("a"…"z"), or null for a post on its own. */
  slideLetter: string | null;
  /**
   * The words before the number, normalised — "Post 1A" and "post_1b" share
   * "post"; "Diwali 1A" is a different set from "Post 1A". The word "post"
   * itself is dropped, so "1A" and "Post 1B" are the same set too.
   */
  prefix: string;
}

/** "Post 1A (1).png", "post_2 copy.jpg" — a second download is the same file. */
export function stemOf(name: string): string {
  let s = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "");
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/\s*\(\d+\)\s*$/, "").replace(/[\s_-]*copy(?:[\s_-]*\d+)?\s*$/i, "");
    if (s === before) break;
  }
  return s.trim();
}

const normalisePrefix = (p: string) =>
  p
    .toLowerCase()
    .replace(/post/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");

/**
 * Words that sit right before a number but make it something other than a post
 * number: a version, a size, a price, a discount.
 */
const NOT_A_POST = /(?:^|[^a-z])(?:v|ver|version|rs|inr|size|no|x)[\s_.-]*$/i;

export function parsePostName(fileName: string): PostName {
  const stem = stemOf(fileName);

  // "…1A", "…1 A", "…1_a", "…1-A": a number, then one letter, at the very end.
  const lettered = stem.match(/^(.*?)(?<!\d)(\d{1,3})[\s_.-]*([a-z])$/i);
  if (lettered && !NOT_A_POST.test(lettered[1])) {
    return { postNumber: Number(lettered[2]), slideLetter: lettered[3].toLowerCase(), prefix: normalisePrefix(lettered[1]) };
  }
  // "…Post 3", "Reel 4", "3": a number at the very end, alone.
  const plain = stem.match(/^(.*?)(?<!\d)(\d{1,3})$/);
  if (plain && !NOT_A_POST.test(plain[1])) {
    return { postNumber: Number(plain[2]), slideLetter: null, prefix: normalisePrefix(plain[1]) };
  }
  return { postNumber: null, slideLetter: null, prefix: normalisePrefix(stem) };
}

/** "a" → 1, "d" → 4 — a slide's place in its carousel. */
export const letterIndex = (letter: string) => letter.toLowerCase().charCodeAt(0) - 96;
/** 1 → "A" — how a slide is named on screen. */
export const letterOf = (n: number) => String.fromCharCode(64 + n);
