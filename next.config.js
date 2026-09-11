/** @type {import('next').NextConfig} */
module.exports = {
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx"],

  outputFileTracingIncludes: {
    "/trust": ["./data/eval/latest.json"],
  },
};