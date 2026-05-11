import { CerealClient } from "/js/base/client.js";

const canvas = document.getElementById("canvas");
const client = new CerealClient(canvas);

function startServer() {
  const serverWorker = new Worker("/js/base/server.js", { type: "module" });
  serverWorker.onerror = () => {
    throw new Error(
      "Failed to start serverWorker, make sure you have no errors or typos",
    );
  };
}
startServer();
setTimeout(async () => {
  const servers = await fetch("/api/servers");
  const res = await servers.json();
  client.connector.makeClientPeer(Object.keys(res)[0]);
  console.log(res);
}, 2000);
