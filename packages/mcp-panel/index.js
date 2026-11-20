/**
 * Host half of the MCP panel.
 *
 * The panel is a browser management surface: it reads the server fleet from
 * the `settings` Remote (the volatile `mcp-manager.servers` map), watches live
 * connection state through `mcpManager.watch`, probes with `mcpManager.probe`
 * and recovers a server with `mcpManager.restart`. Because every operation is
 * already a Host Remote owned by those packages, this half only has to hold
 * the Loader row the client module attaches to. It deliberately registers no
 * service, tool or prompt.
 */

export function apply() {}
