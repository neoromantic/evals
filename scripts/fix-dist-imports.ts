import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"

const root = join(process.cwd(), "dist", "src")
const SUPPORTED_EXTENSIONS = new Set([".js", ".d.ts"])

walk(root)

function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stats = statSync(path)

    if (stats.isDirectory()) {
      walk(path)
      continue
    }

    if (!SUPPORTED_EXTENSIONS.has(getLogicalExtension(path))) {
      continue
    }

    const original = readFileSync(path, "utf8")
    const updated = rewriteRelativeSpecifiers(original)

    if (updated !== original) {
      writeFileSync(path, updated)
    }
  }
}

function getLogicalExtension(path: string): string {
  if (path.endsWith(".d.ts")) {
    return ".d.ts"
  }

  return extname(path)
}

function rewriteRelativeSpecifiers(source: string): string {
  return source
    .replace(/(from\s+["'])(\.[^"']+)(["'])/g, rewriteMatch)
    .replace(/(import\s*\(\s*["'])(\.[^"']+)(["']\s*\))/g, rewriteMatch)
}

function rewriteMatch(
  _match: string,
  prefix: string,
  specifier: string,
  suffix: string,
): string {
  if (!specifier.startsWith(".") || hasKnownExtension(specifier)) {
    return `${prefix}${specifier}${suffix}`
  }

  return `${prefix}${specifier}.js${suffix}`
}

function hasKnownExtension(specifier: string): boolean {
  return [".js", ".mjs", ".cjs", ".json", ".node"].some((extension) =>
    specifier.endsWith(extension),
  )
}
