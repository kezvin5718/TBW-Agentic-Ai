const assert = require("assert");
const fs = require("fs");
const path = require("path");

/**
 * Every staff page must be grantable in Team & Access.
 *
 * There are two lists: SECTIONS in src/lib/sections.ts, which drives the
 * permission editor and the middleware guard, and the sidebar array in the
 * dashboard layout. A page added to the sidebar but not to SECTIONS looks fine
 * — it appears, it works — while being silently outside the permission system:
 * sectionKeyForPath returns null, so both the sidebar filter and the middleware
 * fall through to a plain role check, and a founder has no way to revoke it.
 *
 * Two pages had drifted that way before this check existed. Run it whenever a
 * section is added:  node __tests__/sections.test.js
 */

const root = path.join(__dirname, "..");
const sectionsSrc = fs.readFileSync(path.join(root, "src/lib/sections.ts"), "utf8");
const layoutSrc = fs.readFileSync(path.join(root, "src/app/dashboard/layout.tsx"), "utf8");

const sections = [...sectionsSrc.matchAll(/key:\s*"([^"]+)",\s*num:\s*\d+,\s*name:\s*"([^"]+)",\s*path:\s*"([^"]+)"/g)]
  .map((m) => ({ key: m[1], name: m[2], path: m[3] }));

// The extra prefix map (e.g. whatsapp-inbox → task-manager) counts as covered.
const aliases = [...sectionsSrc.matchAll(/"(\/dashboard\/[^"]+)":\s*"([^"]+)"/g)].map((m) => ({ path: m[1], key: m[2] }));

const prefixes = [...sections.map((s) => ({ path: s.path, key: s.key })), ...aliases]
  .sort((a, b) => b.path.length - a.path.length);

const keyForPath = (p) => {
  const hit = prefixes.find((x) => p === x.path || p.startsWith(x.path + "/"));
  return hit ? hit.key : null;
};

const navItems = [...layoutSrc.matchAll(/name:\s*"([^"]+)",\s*href:\s*"([^"]+)"[^}]*roles:\s*\[([^\]]*)\]/g)]
  .map((m) => ({ name: m[1], href: m[2], roles: m[3].replace(/["\s]/g, "").split(",").filter(Boolean) }));

assert.ok(sections.length > 0, "No sections parsed — has the shape of SECTIONS changed?");
assert.ok(navItems.length > 0, "No nav items parsed — has the shape of the sidebar array changed?");

// Pages every signed-in user gets, and which are therefore not permissions at
// all. Anything else reachable by an employee has to be grantable.
const ALWAYS_ON = ["/dashboard", "/dashboard/profile"];

const ungrantable = navItems.filter(
  (n) => n.roles.includes("employee") && !ALWAYS_ON.includes(n.href) && !keyForPath(n.href)
);

assert.deepStrictEqual(
  ungrantable.map((n) => `${n.name} (${n.href})`),
  [],
  "These pages are reachable by employees but have no entry in SECTIONS, so they cannot be granted or revoked in Team & Access. Add each to SECTIONS in src/lib/sections.ts."
);

// The reverse drift: a section nobody can reach.
const unreachable = sections.filter((s) => !navItems.some((n) => n.href === s.path));
assert.deepStrictEqual(
  unreachable.map((s) => `${s.key} (${s.path})`),
  [],
  "These sections are grantable in Team & Access but have no sidebar link, so granting them does nothing visible. Add a nav item in src/app/dashboard/layout.tsx."
);

const keys = sections.map((s) => s.key);
assert.strictEqual(new Set(keys).size, keys.length, "Duplicate section key.");

console.log(`✅ sections: ${sections.length} registered, ${navItems.length} nav items, every staff page grantable.`);
