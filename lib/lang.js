// Codeforces language ID -> { ext, name, markdown }
// IDs match the `value` attribute of <option> tags in the submit form's
// programTypeId <select>. This list covers the common ones; unknown IDs
// fall back to .txt.
// Reference: inspect https://codeforces.com/contest/{id}/submit

const CF_LANGS = {
  "43": { ext: "c", name: "GNU GCC C11", md: "c" },
  "52": { ext: "cpp", name: "Clang++17 Diagnostics", md: "cpp" },
  "54": { ext: "cpp", name: "GNU G++17 7.3.0", md: "cpp" },
  "61": { ext: "cpp", name: "GNU G++17 9.2.0 (64 bit, msys 2)", md: "cpp" },
  "73": { ext: "cpp", name: "GNU G++17 9.2.0 (64 bit, msys 2)", md: "cpp" },
  "89": { ext: "cpp", name: "GNU G++20 13.2 (64 bit, winlibs)", md: "cpp" },
  "91": { ext: "cpp", name: "GNU G++23 14.2 (64 bit, msys2)", md: "cpp" },
  "50": { ext: "cpp", name: "GNU G++14 6.4.0", md: "cpp" },
  "80": { ext: "cpp", name: "Clang++20 Diagnostics", md: "cpp" },
  "36": { ext: "java", name: "Java 8", md: "java" },
  "60": { ext: "java", name: "Java 11", md: "java" },
  "74": { ext: "java", name: "Java 17", md: "java" },
  "87": { ext: "java", name: "Java 21", md: "java" },
  "7":  { ext: "py", name: "Python 2", md: "python" },
  "31": { ext: "py", name: "Python 3", md: "python" },
  "70": { ext: "py", name: "PyPy 3.10", md: "python" },
  "41": { ext: "py", name: "PyPy 3", md: "python" },
  "40": { ext: "py", name: "PyPy 2", md: "python" },
  "75": { ext: "kt", name: "Kotlin 1.7", md: "kotlin" },
  "83": { ext: "kt", name: "Kotlin 1.9", md: "kotlin" },
  "88": { ext: "kt", name: "Kotlin 2.1", md: "kotlin" },
  "49": { ext: "kt", name: "Kotlin 1.5", md: "kotlin" },
  "9":  { ext: "cs", name: "C# Mono", md: "csharp" },
  "79": { ext: "cs", name: ".NET Core C#", md: "csharp" },
  "65": { ext: "cs", name: ".NET Core C# 10", md: "csharp" },
  "32": { ext: "go", name: "Go", md: "go" },
  "76": { ext: "go", name: "Go 1.22", md: "go" },
  "90": { ext: "go", name: "Go 1.23", md: "go" },
  "75-rust": { ext: "rs", name: "Rust", md: "rust" },
  "49-rust": { ext: "rs", name: "Rust 2021", md: "rust" },
  "75-rust2024": { ext: "rs", name: "Rust 2024", md: "rust" },
  "4":  { ext: "pl", name: "Perl", md: "perl" },
  "13": { ext: "pas", name: "Pascal", md: "pascal" },
  "51": { ext: "pas", name: "PascalABC.NET", md: "pascal" },
  "8":  { ext: "rb", name: "Ruby", md: "ruby" },
  "67": { ext: "rb", name: "Ruby 3", md: "ruby" },
  "34": { ext: "js", name: "JavaScript (V8)", md: "javascript" },
  "55": { ext: "js", name: "Node.js", md: "javascript" },
  "78": { ext: "ts", name: "TypeScript", md: "typescript" },
  "19": { ext: "ml", name: "OCaml", md: "ocaml" },
  "28": { ext: "d", name: "D DMD32", md: "d" },
  "20": { ext: "scala", name: "Scala", md: "scala" },
  "48": { ext: "kt", name: "Kotlin", md: "kotlin" },
  "12": { ext: "hs", name: "Haskell", md: "haskell" },
  "14": { ext: "php", name: "PHP", md: "php" },
  "3":  { ext: "dpr", name: "Delphi", md: "pascal" },
};

function cfLangInfo(langId) {
  const hit = CF_LANGS[String(langId)];
  if (hit) return hit;
  return { ext: "txt", name: `Language ${langId}`, md: "" };
}

// Expose for content script + popup (which load this via <script> tag / manifest).
if (typeof globalThis !== "undefined") {
  globalThis.CF_LANGS = CF_LANGS;
  globalThis.cfLangInfo = cfLangInfo;
}
// And for the service worker (ES module import).
if (typeof module !== "undefined") {
  module.exports = { CF_LANGS, cfLangInfo };
}
