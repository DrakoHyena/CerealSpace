import { CerealClient } from "/js/base/client.js";

const menu = document.getElementById("container");

const hostBtn = document.getElementById("host");
const quickJoinBtn = document.getElementById("quickJoin");
const serverListDiv = document.getElementById("serverList");

const canvas = document.getElementById("canvas");
const client = new CerealClient(canvas);

function hideMenu() {
  menu.style.display = "none";
}

function showMenu() {
  menu.style.display = "block";
}

async function hostServer() {
  const serverWorker = new Worker("/js/base/server.js", { type: "module" });
  serverWorker.onerror = () => {
    throw new Error(
      "Failed to start serverWorker, make sure you have no errors or typos",
    );
  };
  const serverId = await client.connector.makeServerPeer(serverWorker);
  return serverId;
}

async function joinServer(serverId) {
  const dc = await client.connector.makeClientPeer(serverId);
  client.connector.addConnection(dc);
}

let servers = {};
async function updateServers() {
  const res = await fetch("/api/servers");
  if (!res.ok) {
    throw new Error(`Failed to update servers (${res.status})`);
  }
  servers = await res.json();

  if (servers.length === 0) {
    serverListDiv.innerHTML = "No servers found";
    return;
  }

  serverListDiv.innerHTML = "";
  for (let roomId in servers) {
    const roomData = servers[roomId];
    const div = document.createElement("div");

    const p1 = document.createElement("p");
    p1.textContent = roomId;
    div.appendChild(p1);

    const p2 = document.createElement("p");
    p2.textContent = JSON.stringify(roomData);
    div.appendChild(p2);

    div.onclick = async () => {
      joinServer(roomId);
    };

    serverListDiv.appendChild(div);
  }
}

hostBtn.onclick = async () => {
  hideMenu();
  joinServer(await hostServer());
};

quickJoinBtn.onclick = async () => {
  hideMenu();
  const serverArr = Object.keys(servers);
  joinServer(serverArr[(Math.random() * serverArr.length) | 0]);
};

setInterval(() => {
  updateServers();
}, 5000);
updateServers();
