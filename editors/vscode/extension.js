// Starts `ore lsp` for .ore files.
const { workspace } = require("vscode")
const { LanguageClient } = require("vscode-languageclient/node")

/** @type {LanguageClient | undefined} */
let client

async function activate() {
  const command = workspace.getConfiguration("ore").get("path") || "ore"
  const server = { command, args: ["lsp"] }
  client = new LanguageClient("ore", "Ore", { run: server, debug: server }, { documentSelector: [{ scheme: "file", language: "ore" }] })
  await client.start()
}

function deactivate() {
  return client?.stop()
}

module.exports = { activate, deactivate }
