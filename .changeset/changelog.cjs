/**
 * Custom changelog generator for changesets.
 * Outputs clean bullet points without commit hashes or "Minor/Patch/Major Changes" subheadings.
 */

async function getReleaseLine(changeset) {
  const lines = changeset.summary
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  return lines
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
}

async function getDependencyReleaseLine() {
  return "";
}

module.exports = {
  getReleaseLine,
  getDependencyReleaseLine
};
