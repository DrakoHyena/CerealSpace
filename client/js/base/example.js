import { CONFIG } from "/js/base/config.js";
import { CerealClient } from "/js/base/client.js";
import { CerealPeer } from "/js/base/connector.js";
import { MODES } from "/js/base/connector.js";

const menu = document.getElementById("container");

const hostBtn = document.getElementById("host");
const hostSettingsBtn = document.getElementById("hostSettings");
const quickJoinBtn = document.getElementById("quickJoin");

const turnUrl = document.getElementById("turnUrl");
const turnUsername = document.getElementById("turnUsername");
const turnPassword = document.getElementById("turnPassword");

const serverListDiv = document.getElementById("serverList");
const hostSettingsDiv = document.getElementById("hostSettingsDiv");

const canvas = document.getElementById("canvas");
const client = new CerealClient(canvas);

function hideMenu() {
  menu.style.display = "none";
}

function showMenu() {
  menu.style.display = "block";
}

function hideHostSettings() {
  hostSettingsDiv.style.display = "none";
}

function showHostSettings() {
  hostSettingsDiv.style.display = "block";
}

function toggleHostSettings() {
  if (hostSettingsDiv.style.display === "none") {
    showHostSettings();
  } else {
    hideHostSettings();
  }
}

const savedTurnUrl = localStorage.getItem("savedTurnUrl");
if (savedTurnUrl) turnUrl.value = savedTurnUrl;
const savedTurnUsername = localStorage.getItem("savedTurnUsername");
if (savedTurnUsername) turnUsername.value = savedTurnUsername;
const savedTurnPassword = localStorage.getItem("savedTurnPassword");
if (savedTurnPassword) turnPassword.value = savedTurnPassword;

async function hostServer() {
  const turnUrlValue = turnUrl.value;
  const turnUsernameValue = turnUsername.value || "username";
  const turnPasswordValue = turnPassword.value || "password";
  localStorage.setItem("savedTurnUrl", turnUrlValue);
  localStorage.setItem("savedTurnUsername", turnUsernameValue);
  localStorage.setItem("savedTurnPassword", turnPasswordValue);

  const serverWorker = new Worker("/js/base/server.js", { type: "module" });
  serverWorker.onerror = () => {
    throw new Error(
      "Failed to start serverWorker, make sure you have no errors or typos",
    );
  };

  const cerealPeer = new CerealPeer(MODES.SERVER, undefined, serverWorker);
  cerealPeer.iceServers = turnUrlValue.startsWith("turn")
    ? [
        ...CONFIG.CerealConnector.iceServers,
        {
          urls: turnUrlValue,
          username: turnUsernameValue,
          credential: turnPasswordValue,
        },
      ]
    : CONFIG.CerealConnector.iceServers;

  let res;
  const prom = new Promise((pRes) => (res = pRes));
  cerealPeer.onWsOpen(() => {
    console.log("Cereal Peer opened");
    res(cerealPeer.ws.socketId);
  });
  console.log(cerealPeer);
  return prom;
}

async function joinServer(serverId, ICE_SERVERS) {
  const cerealPeer = new CerealPeer(MODES.CLIENT, serverId);
  cerealPeer.makeClientPeer(ICE_SERVERS);
  client.connector.addConnection(cerealPeer);
}

let servers = {};
async function updateServers() {
  const res = await fetch("/api/servers");
  if (!res.ok) {
    throw new Error(`Failed to update servers (${res.status})`);
  }
  servers = await res.json();

  if (Object.keys(servers).length === 0) {
    serverListDiv.innerHTML = "<p>No servers found</p>";
    return;
  }

  serverListDiv.innerHTML = "";
  for (let roomId in servers) {
    const roomData = servers[roomId];
    const div = document.createElement("div");

    const serverId = document.createElement("h6");
    serverId.textContent = `Server Id: ${roomId}`;
    div.appendChild(serverId);

    const timeDiff = Date.now() - roomData.created;
    const createdAt = document.createElement("h6");
    createdAt.textContent = `Created ${
      timeDiff > 1000 * 60 * 60 === true
        ? (timeDiff / (1000 * 60 * 60)).toFixed(2) + "hrs"
        : (timeDiff / (1000 * 60)).toFixed(2) + "mins"
    } ago`;
    div.appendChild(createdAt);

    const iceServersTitle = document.createElement("h6");
    iceServersTitle.textContent = "ICE Servers Used:";
    div.appendChild(iceServersTitle);
    for (let iceServer of roomData.iceServers) {
      const iceServerUrl = document.createElement("h6");
      iceServerUrl.textContent = iceServer.urls;
      div.appendChild(iceServerUrl);
    }

    div.onclick = async () => {
      hideMenu();
      joinServer(roomId, roomData.iceServers);
    };

    serverListDiv.appendChild(div);
  }
}

hostBtn.onclick = async () => {
  hideMenu();
  joinServer(await hostServer(), CONFIG.CerealConnector.iceServers);
};

hostSettingsBtn.onclick = async () => {
  toggleHostSettings();
};

quickJoinBtn.onclick = async () => {
  const serverArr = Object.keys(servers);
  if (serverArr.length === 0) return;
  hideMenu();
  const i = (Math.random() * serverArr.length) | 0;
  joinServer(serverArr[i], Object.values(serverArr)[i].iceServers);
};

setInterval(() => {
  updateServers();
}, 30000);
updateServers();
