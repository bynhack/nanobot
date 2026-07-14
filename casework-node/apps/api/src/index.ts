import { buildServer } from "./app.js";

const { server, config } = await buildServer();
const webui = config.channels.webui_plugin;
const address = await server.listen({ host: webui.host, port: webui.port });
server.log.info(`Casework Node started at ${address}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close());
}
