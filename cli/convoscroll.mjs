#!/usr/bin/env node
// convoscroll — render Conversation Markdown, document JSON or .convcanvas into PNG
// with the same ConversationCanvas and export session as the web app.
// Rendering runs in headless Chrome; every request outside the bundled render page
// and the input's own directory is blocked.
import { main, report } from "./render-cli.mjs";

const argv = process.argv.slice(2);
main(argv).then(
  (code) => { process.exitCode = code; },
  (error) => { process.exitCode = report(error, argv.includes("--json")); },
);
