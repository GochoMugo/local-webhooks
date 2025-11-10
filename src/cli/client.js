const http = require("http");
const path = require("path");

const wserver = require("@forfuture/wserver");
const chalk = require("chalk")

const configFilepath = process.argv[2];
if (!configFilepath) {
  console.error("usage: lw-client <path/to/config>");
  process.exit(1);
}

const config = require(path.resolve(configFilepath));
const remoteUrl = config.remoteUrl || "https://lw.gocho.live/ws";
const localApps = config.localApps || [];
const websocket = new wserver.Client(
  `${remoteUrl}?appSecrets=${localApps.map((a) => a.secret).join(",")}`
);
let requestIndex = 0;

websocket.on("request", function(websocketNotification) {
  const localApp = localApps.find(
    (a) => a.secret === websocketNotification.appSecret
  );
  if (!localApp) {
    return;
  }

  const { notificationId } = websocketNotification;
  const onError = (error) => console.error(error);

  const name = chalk.green(localApp.name);
  const timestamp = new Date().toISOString();
  console.log(`${++requestIndex}. ${timestamp} [${notificationId}] ${name}`);

  const appRequest = http.request(
    localApp.url,
    {
      headers: websocketNotification.webhookPayload.headers,
      method: "POST"
    },
    function(res) {
      res.on("error", onError);

      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        websocket
          .request("response", {
            notificationId,
            webhookPayload: {
              body: chunks.join(""),
              headers: res.headers,
              statusCode: res.statusCode
            }
          })
          .catch(onError);
      });
    }
  );
  appRequest.on("error", onError);
  appRequest.write(websocketNotification.webhookPayload.body);
  appRequest.end();
});

websocket.on("error", console.error);

websocket.on("open", function () {
  const webhookUrl = `${remoteUrl.replace(/\/ws$/, "")}/webhook`;

  console.log(`You are now connected to the Internet.\n\nHere are your webhook URLs:`)
  localApps.forEach(function (app, index) {
    const url = chalk.green(`${webhookUrl}/${app.secret}`);
    console.log(`    ${index + 1}. ${app.name} ⇒\t${url}`)
  });
  console.log(`\nYour local apps are ready for POST webhook requests.\n`);
});
